import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  clearPendingEntry,
  createEntryKey,
  fetchStockEntry,
  readPendingEntry,
  savePendingEntry,
  stockEntryError,
  submitStockEntry,
  validateStockEntry,
} from "./stock-entries";
import type {
  PendingStockEntry,
  StockEntryDraft,
  StockEntryInput,
} from "./stock-entries";
import type { StockMovement } from "./stock-movements";

export interface StockEntryProps {
  userId: string;
  productId: string;
  disabled?: boolean;
  isCurrentSession: () => boolean;
  onBusyChange: (busy: boolean) => void;
  onRecorded: () => void;
}
const blank: StockEntryDraft = { quantity: "", reason: "" };
const status = (value: unknown) =>
  value && typeof value === "object" && "status" in value
    ? Number(value.status)
    : undefined;
const sameId = (a: string | undefined, b: string) =>
  typeof a === "string" && a.toLowerCase() === b.toLowerCase();

export function useStockEntry(props: StockEntryProps) {
  const [owner] = useState(() => ({
    userId: props.userId,
    productId: props.productId,
  }));
  const [initial] = useState(() =>
    readPendingEntry(owner.userId, owner.productId),
  );
  const [draft, setDraft] = useState<StockEntryDraft>(blank);
  const [review, setReview] = useState<StockEntryInput | null>(null);
  const [pending, setPending] = useState<PendingStockEntry | null>(
    initial.pending,
  );
  const [receipt, setReceipt] = useState<StockMovement | null>(null);
  const [validation, setValidation] = useState<
    Partial<Record<keyof StockEntryDraft, string>>
  >({});
  const [storageBlocked, setStorageBlocked] = useState(initial.blocked);
  const [cleanupFailed, setCleanupFailed] = useState(false);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(
    initial.blocked
      ? "Não foi possível conferir a tentativa salva neste navegador. Consulte o histórico antes de registrar uma entrada."
      : "",
  );
  const callbacks = useRef(props);
  const alive = useRef(true);
  const revision = useRef(0);
  const request = useRef<AbortController | null>(null);
  const writeLock = useRef(false);
  const pendingRef = useRef(initial.pending);
  useLayoutEffect(() => {
    callbacks.current = props;
  });
  const matchesOwner =
    props.userId === owner.userId && props.productId === owner.productId;
  const current = () =>
    alive.current &&
    callbacks.current.userId === owner.userId &&
    callbacks.current.productId === owner.productId &&
    callbacks.current.isCurrentSession();
  const canStart = () =>
    current() && !denied && !callbacks.current.disabled && !request.current;

  function fail(caught: unknown) {
    if (!current()) return;
    setError(stockEntryError(caught));
    if (status(caught) === 401 || status(caught) === 403) {
      setDenied(true);
      setDraft(blank);
      setReview(null);
      setPending(null);
      setReceipt(null);
      setValidation({});
      pendingRef.current = null;
    }
  }
  function complete(value: StockMovement, attempt: PendingStockEntry) {
    if (
      value.type !== "STOCK_RECEIPT" ||
      !sameId(value.product.id, owner.productId) ||
      !sameId(value.actor?.id, owner.userId) ||
      value.change.availableQuantity !== attempt.quantity ||
      value.reason !== attempt.reason
    ) {
      throw Object.assign(new Error("Resposta inválida."), {
        code: "INVALID_RESPONSE",
      });
    }
    setReceipt(value);
    try {
      clearPendingEntry(owner.userId, owner.productId, attempt.key);
    } catch {
      setCleanupFailed(true);
      setError(
        "Entrada confirmada. Não foi possível limpar a tentativa salva no navegador. Verifique novamente antes de registrar outra entrada.",
      );
      return false;
    }
    pendingRef.current = null;
    setPending(null);
    setReview(null);
    setDraft(blank);
    setCleanupFailed(false);
    setStorageBlocked(false);
    setSuccess(true);
    setError("");
    return true;
  }
  async function verify() {
    const attempt = pendingRef.current;
    if (!canStart() || !attempt) return;
    const controller = new AbortController(),
      started = ++revision.current;
    request.current = controller;
    setChecking(true);
    setError("");
    let recorded = false;
    try {
      const result = await fetchStockEntry(
        owner.productId,
        attempt.key,
        controller,
      );
      if (current() && revision.current === started)
        recorded = complete(result, attempt);
    } catch (caught) {
      if (current() && revision.current === started) {
        if (status(caught) === 404)
          setError(
            "A entrada ainda não foi confirmada. Verifique novamente ou reenvie a mesma entrada.",
          );
        else fail(caught);
      }
    } finally {
      if (request.current === controller) request.current = null;
      if (current() && revision.current === started) setChecking(false);
    }
    if (recorded && current() && revision.current === started)
      callbacks.current.onRecorded();
  }
  async function send(attempt: PendingStockEntry) {
    if (!canStart() || storageBlocked || receipt || writeLock.current) return;
    const controller = new AbortController(),
      started = ++revision.current;
    request.current = controller;
    writeLock.current = true;
    setBusy(true);
    setError("");
    callbacks.current.onBusyChange(true);
    let recorded = false;
    try {
      const result = await submitStockEntry(
        owner.productId,
        attempt,
        controller,
      );
      if (current() && revision.current === started)
        recorded = complete(result, attempt);
    } catch (caught) {
      if (revision.current === started) fail(caught);
    } finally {
      if (request.current === controller) request.current = null;
      writeLock.current = false;
      if (current() && revision.current === started) {
        setBusy(false);
        callbacks.current.onBusyChange(false);
      }
    }
    if (recorded && current() && revision.current === started)
      callbacks.current.onRecorded();
  }
  function stop() {
    if (writeLock.current && current()) callbacks.current.onBusyChange(false);
    alive.current = false;
    revision.current++;
    request.current?.abort();
    request.current = null;
    writeLock.current = false;
  }
  useEffect(() => {
    alive.current = true;
    let active = true;
    void Promise.resolve().then(() => {
      if (active && initial.pending && !initial.blocked) return verify();
    });
    return () => {
      active = false;
      stop();
    };
    // The parent remounts this form for a different product or session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return {
    draft,
    review,
    pending,
    receipt,
    validation,
    storageBlocked,
    cleanupFailed,
    denied,
    busy,
    checking,
    success,
    error,
    matchesOwner,
    disabled: Boolean(props.disabled || busy || checking),
    change: (key: keyof StockEntryDraft, value: string) => {
      if (
        !canStart() ||
        pendingRef.current ||
        review ||
        storageBlocked ||
        success
      )
        return;
      setDraft((previous) => ({ ...previous, [key]: value }));
      setValidation((previous) => ({ ...previous, [key]: undefined }));
    },
    prepare: (): keyof StockEntryDraft | undefined => {
      if (!canStart() || pendingRef.current || storageBlocked || success)
        return;
      const checked = validateStockEntry(draft);
      setValidation(checked.errors);
      if (!checked.input)
        return Object.keys(checked.errors)[0] as keyof StockEntryDraft;
      setReview(checked.input);
      setError("");
    },
    edit: () => {
      if (canStart() && !pendingRef.current) setReview(null);
    },
    confirm: () => {
      if (
        !canStart() ||
        !review ||
        pendingRef.current ||
        storageBlocked ||
        success
      )
        return;
      try {
        const attempt = { ...review, key: createEntryKey() };
        savePendingEntry(owner.userId, owner.productId, attempt);
        pendingRef.current = attempt;
        setPending(attempt);
        setReview(null);
        void send(attempt);
      } catch {
        setStorageBlocked(true);
        setError(
          "Não foi possível proteger esta tentativa no navegador. Consulte o histórico antes de continuar.",
        );
      }
    },
    retry: () => {
      const attempt = pendingRef.current;
      if (attempt && !receipt) void send(attempt);
    },
    verify: () => {
      void verify();
    },
  };
}
