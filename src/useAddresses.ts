import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Address, AddressInput } from "./ShippingAddresses";
import {
  createAddress,
  deleteAddress,
  fetchAddress,
  fetchAddresses,
  replaceAddress,
} from "./addresses";

export type AddressView =
  { type: "create" } | { type: "edit" | "remove"; address: Address };
const status = (error: unknown) =>
  error && typeof error === "object" && "status" in error
    ? Number(error.status)
    : undefined;
function failureMessage(error: unknown, writing: boolean) {
  switch (status(error)) {
    case 401:
    case 403:
      return "Não foi possível acessar os endereços desta conta. Entre novamente.";
    case 400:
      return "Confira os dados do endereço e atualize a lista antes de tentar novamente.";
    case 404:
      return "Endereço não encontrado. Atualize a lista para conferir os dados atuais.";
    case 409:
      return "Os endereços mudaram ou a operação não é permitida. Atualize a lista antes de continuar. Cada conta aceita até 20 endereços; escolha outro principal antes de desmarcar o atual.";
    default:
      return writing
        ? "Não foi possível confirmar a alteração. Ela pode ter sido concluída. Atualize os endereços antes de continuar."
        : "Não foi possível consultar os endereços. Atualize a lista para tentar novamente.";
  }
}

export function useAddresses(
  isCurrentSession: () => boolean,
  onBusyChange: (busy: boolean) => void,
) {
  const [addresses, setAddresses] = useState<Address[] | null>(null);
  const [view, setView] = useState<AddressView | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [createReview, setCreateReview] = useState(false);
  const [createReviewReady, setCreateReviewReady] = useState(false);
  const [createReviewed, setCreateReviewed] = useState(false);
  const alive = useRef(true);
  const mutation = useRef(false);
  const revision = useRef(0);
  const read = useRef<AbortController | null>(null);
  const write = useRef<AbortController | null>(null);
  const uncertainCreation = useRef(false);
  const callbacks = useRef({ isCurrentSession, onBusyChange });
  useLayoutEffect(() => {
    callbacks.current = { isCurrentSession, onBusyChange };
  }, [isCurrentSession, onBusyChange]);
  const current = () => alive.current && callbacks.current.isCurrentSession();

  function fail(caught: unknown, writing = false) {
    if (!current()) return;
    setError(failureMessage(caught, writing));
    setBlocked(true);
    if ([401, 403].includes(status(caught) ?? 0)) {
      setAddresses(null);
      setView(null);
      setDenied(true);
    }
  }
  async function load(manual = false) {
    if (mutation.current || !current() || denied) return;
    read.current?.abort();
    const controller = new AbortController();
    read.current = controller;
    const started = ++revision.current;
    setLoading(true);
    setChecking(false);
    setView(null);
    setError("");
    setNotice("");
    setBlocked(true);
    setCreateReviewed(false);
    setCreateReviewReady(false);
    try {
      const data = await fetchAddresses(controller);
      if (!current() || revision.current !== started) return;
      setAddresses(data);
      setBlocked(false);
      if (manual && uncertainCreation.current) setCreateReviewReady(true);
    } catch (caught) {
      if (revision.current === started) fail(caught);
    } finally {
      if (current() && revision.current === started) setLoading(false);
    }
  }
  function stop() {
    alive.current = false;
    revision.current++;
    read.current?.abort();
    write.current?.abort();
    if (mutation.current) callbacks.current.onBusyChange(false);
  }
  useEffect(() => {
    alive.current = true;
    let active = true;
    void Promise.resolve().then(() => {
      if (active) return load();
    });
    return () => {
      active = false;
      stop();
    };
    // This mounted account owns the requests; current callbacks and controllers live in refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openExisting(id: string, type: "edit" | "remove") {
    if (
      mutation.current ||
      loading ||
      checking ||
      blocked ||
      denied ||
      !current() ||
      !addresses?.some((address) => address.id === id)
    )
      return;
    read.current?.abort();
    const controller = new AbortController();
    read.current = controller;
    const started = ++revision.current;
    setChecking(true);
    setView(null);
    setError("");
    setNotice("");
    try {
      const address = await fetchAddress(id, controller);
      if (current() && revision.current === started) setView({ type, address });
    } catch (caught) {
      if (revision.current === started) fail(caught);
    } finally {
      if (current() && revision.current === started) setChecking(false);
    }
  }
  function cancel() {
    if (mutation.current || !current()) return;
    revision.current++;
    read.current?.abort();
    setChecking(false);
    setView(null);
    setError("");
  }
  async function perform(input?: AddressInput) {
    if (
      mutation.current ||
      loading ||
      checking ||
      blocked ||
      denied ||
      !current() ||
      !view ||
      !addresses
    )
      return;
    if (view.type !== "remove" && !input) return;
    if (
      view.type === "create" &&
      (uncertainCreation.current || addresses.length >= 20)
    )
      return;
    const snapshot = view;
    const controller = new AbortController();
    write.current = controller;
    mutation.current = true;
    revision.current++;
    read.current?.abort();
    setBusy(true);
    callbacks.current.onBusyChange(true);
    setError("");
    setNotice("");
    let confirmed = false;
    try {
      if (snapshot.type === "create") await createAddress(input!, controller);
      else if (snapshot.type === "edit")
        await replaceAddress(snapshot.address.id, input!, controller);
      else await deleteAddress(snapshot.address.id, controller);
      confirmed = true;
      if (!current()) return;
      setView(null);
      const refreshController = new AbortController();
      read.current = refreshController;
      const data = await fetchAddresses(refreshController);
      if (!current()) return;
      setAddresses(data);
      setBlocked(false);
      setNotice(
        snapshot.type === "create"
          ? "Endereço cadastrado."
          : snapshot.type === "edit"
            ? "Endereço atualizado."
            : "Endereço removido. Confira o endereço principal na lista atualizada.",
      );
    } catch (caught) {
      if (!current()) return;
      setView(null);
      setCreateReviewed(false);
      setCreateReviewReady(false);
      if (
        snapshot.type === "create" &&
        !confirmed &&
        (status(caught) === undefined ||
          Number(status(caught)) >= 500 ||
          status(caught) === 408)
      ) {
        uncertainCreation.current = true;
        setCreateReview(true);
      }
      fail(caught, !confirmed);
      if (confirmed && ![401, 403].includes(status(caught) ?? 0))
        setError(
          "A alteração foi recebida, mas não foi possível atualizar a lista. Atualize os endereços antes de continuar.",
        );
    } finally {
      mutation.current = false;
      if (write.current === controller) write.current = null;
      if (current()) {
        setBusy(false);
        callbacks.current.onBusyChange(false);
      }
    }
  }
  return {
    addresses,
    view,
    loading,
    checking,
    busy,
    blocked,
    denied,
    error,
    notice,
    createReview,
    createReviewReady,
    createReviewed,
    refresh: () => void load(true),
    openCreate: () => {
      if (
        !mutation.current &&
        !loading &&
        !checking &&
        !blocked &&
        !denied &&
        current() &&
        addresses &&
        addresses.length < 20 &&
        !uncertainCreation.current
      ) {
        setView({ type: "create" });
        setError("");
        setNotice("");
      }
    },
    openExisting,
    cancel,
    save: (input: AddressInput) => perform(input),
    remove: () => perform(),
    setCreateReviewed: (value: boolean) => {
      if (current() && createReviewReady && !mutation.current)
        setCreateReviewed(value);
    },
    releaseCreate: () => {
      if (
        !current() ||
        mutation.current ||
        blocked ||
        !createReviewReady ||
        !createReviewed
      )
        return;
      uncertainCreation.current = false;
      setCreateReview(false);
      setCreateReviewReady(false);
      setCreateReviewed(false);
      setNotice(
        "Conferência registrada. Cadastre novamente somente se o endereço ainda não existir.",
      );
    },
  };
}
