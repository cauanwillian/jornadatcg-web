import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { authorized } from "./session";
import {
  labelActions,
  safeLabelPrintUrl,
  validateExpectedCost,
  validateRecoveryId,
} from "./admin-shipments";
import type {
  AdminShipmentDetail,
  AdminShipmentsPage,
  CreateLabelInput,
  LabelPrintResult,
  PackShipmentResult,
  ShippingLabelDto,
} from "./admin-shipments";

export type ShipmentOperation =
  "pack" | "create" | "recover" | "checkout" | "generate" | "sync" | "print";
export type ShipmentOperationInput = CreateLabelInput | string;
const status = (error: unknown) =>
  error && typeof error === "object" && "status" in error
    ? Number(error.status)
    : undefined;
function errorText(error: unknown) {
  switch (status(error)) {
    case 400:
      return "Confira os dados informados e consulte o envio antes de tentar novamente.";
    case 401:
      return "Sua sessão expirou. Entre novamente.";
    case 403:
      return "Acesso restrito a administradores.";
    case 404:
      return "Envio ou etiqueta não encontrado. Atualize os dados.";
    case 409:
      return "O estado do envio ou da etiqueta mudou, ou a operação exige revisão. Atualize o envio antes de continuar; se houver uma tentativa pendente, sincronize ou recupere a mesma etiqueta.";
    default:
      return "Não foi possível confirmar a operação. Ela pode ter sido concluída. Atualize o envio antes de qualquer nova tentativa.";
  }
}
const noticeText: Record<ShipmentOperation, string> = {
  pack: "Conferência da embalagem registrada.",
  create:
    "Solicitação de criação da etiqueta concluída. Confira o estado atualizado.",
  recover: "Etiqueta recuperada. Confira os dados atualizados.",
  checkout:
    "Compra da etiqueta solicitada. Confira a confirmação do provedor abaixo.",
  generate:
    "Geração solicitada. A etiqueta ficará disponível após a confirmação do provedor.",
  sync: "Estado da etiqueta consultado no Melhor Envio.",
  print: "Link de impressão disponível.",
};
function detailRecord(
  value: unknown,
  id: string,
): value is AdminShipmentDetail {
  if (!value || typeof value !== "object") return false;
  const row = value as AdminShipmentDetail;
  return (
    row.id === id &&
    typeof row.status === "string" &&
    Array.isArray(row.items) &&
    row.items.every(
      (item) =>
        typeof item.quantity === "number" &&
        item.orderItem &&
        typeof item.orderItem.cardName === "string",
    ) &&
    Object.hasOwn(row, "label") &&
    (row.label === null ||
      (row.label?.shipmentId === id &&
        typeof row.label.provider === "string" &&
        typeof row.label.status === "string"))
  );
}

async function requestWithDeadline<T>(
  path: string,
  controller: AbortController,
  method: "GET" | "POST" = "GET",
  body?: unknown,
): Promise<T> {
  const interrupted = new Promise<never>((_, reject) =>
    controller.signal.addEventListener(
      "abort",
      () => reject(new DOMException("Aborted", "AbortError")),
      { once: true },
    ),
  );
  const timer = window.setTimeout(() => controller.abort(), 15000);
  try {
    return await Promise.race([
      authorized<T>(path, {
        method,
        signal: controller.signal,
        cache: "no-store",
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      interrupted,
    ]);
  } finally {
    window.clearTimeout(timer);
  }
}

export function useAdminShipments(
  isCurrentSession: () => boolean,
  onBusyChange: (busy: boolean) => void,
  initialShipmentId?: string,
) {
  const [initialId] = useState(() =>
    initialShipmentId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      initialShipmentId,
    )
      ? initialShipmentId
      : null,
  );
  const [queue, setQueue] = useState<AdminShipmentsPage | null>(null);
  const [page, setPage] = useState(1);
  const [queueVersion, setQueueVersion] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(initialId);
  const [detail, setDetail] = useState<AdminShipmentDetail | null>(null);
  const [detailVersion, setDetailVersion] = useState(0);
  const [loading, setLoading] = useState(!initialId);
  const [checking, setChecking] = useState(Boolean(initialId));
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [printUrl, setPrintUrl] = useState<string | null>(null);
  const alive = useRef(true);
  const lock = useRef(false);
  const selected = useRef<string | null>(initialId);
  const revision = useRef(0);
  const detailRequest = useRef<AbortController | null>(null);
  const mutationRequest = useRef<AbortController | null>(null);
  const callbacks = useRef({ isCurrentSession, onBusyChange });
  useLayoutEffect(() => {
    callbacks.current = { isCurrentSession, onBusyChange };
  }, [isCurrentSession, onBusyChange]);
  const valid = () => alive.current && callbacks.current.isCurrentSession();
  function fail(caught: unknown) {
    if (!valid()) return;
    setPrintUrl(null);
    if (status(caught) === 403) {
      setDenied(true);
      setQueue(null);
      setDetail(null);
    }
    setError(errorText(caught));
  }
  function stop() {
    alive.current = false;
    revision.current++;
    detailRequest.current?.abort();
    mutationRequest.current?.abort();
    if (lock.current) callbacks.current.onBusyChange(false);
  }
  useEffect(() => {
    alive.current = true;
    return stop;
  }, []);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active && initialId && valid()) return fetchDetail(initialId);
    });
    return () => {
      active = false;
    };
    // A shipment link is consumed once; a different link remounts the panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (selectedId || denied) return;
    let active = true;
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setQueue(null);
      try {
        const result = await requestWithDeadline<AdminShipmentsPage>(
          `/admin/shipments?page=${page}&pageSize=12`,
          controller,
        );
        if (
          !result ||
          !Array.isArray(result.items) ||
          !Number.isInteger(result.total) ||
          result.total < 0
        )
          throw new Error();
        if (active && valid()) {
          const lastPage = Math.max(1, Math.ceil(result.total / 12));
          if (page > lastPage) setPage(lastPage);
          else setQueue(result);
        }
      } catch (caught) {
        if (active) fail(caught);
      } finally {
        if (active && valid()) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [page, queueVersion, selectedId, denied]);
  async function fetchDetail(id: string): Promise<AdminShipmentDetail | null> {
    detailRequest.current?.abort();
    const controller = new AbortController();
    detailRequest.current = controller;
    const started = ++revision.current;
    setChecking(true);
    setBlocked(true);
    setPrintUrl(null);
    try {
      const result = await requestWithDeadline<AdminShipmentDetail>(
        `/admin/shipments/${id}`,
        controller,
      );
      if (!detailRecord(result, id)) throw new Error();
      if (valid() && selected.current === id && revision.current === started) {
        setDetail(result);
        setDetailVersion((value) => value + 1);
        setBlocked(false);
        return result;
      }
    } catch (caught) {
      if (selected.current === id && revision.current === started) fail(caught);
    } finally {
      if (valid() && selected.current === id && revision.current === started)
        setChecking(false);
    }
    return null;
  }
  function open(id: string) {
    if (lock.current || !valid()) return;
    selected.current = id;
    setSelectedId(id);
    setDetail(null);
    setError("");
    setNotice("");
    void fetchDetail(id);
  }
  function back() {
    if (lock.current) return;
    revision.current++;
    detailRequest.current?.abort();
    selected.current = null;
    setSelectedId(null);
    setDetail(null);
    setChecking(false);
    setPrintUrl(null);
    setError("");
    setNotice("");
  }
  function refreshDetail() {
    if (!lock.current && selected.current && valid()) {
      setError("");
      setNotice("");
      void fetchDetail(selected.current);
    }
  }
  async function actionRequest<T>(
    path: string,
    method: "GET" | "POST",
    body?: unknown,
  ): Promise<T> {
    const controller = new AbortController();
    mutationRequest.current = controller;
    try {
      return await requestWithDeadline<T>(path, controller, method, body);
    } finally {
      if (mutationRequest.current === controller)
        mutationRequest.current = null;
    }
  }
  async function run(
    operation: ShipmentOperation,
    input?: ShipmentOperationInput,
  ) {
    if (lock.current || checking || blocked || !detail || !valid() || denied)
      return;
    const snapshot = detail;
    const permitted = labelActions(snapshot, snapshot.label);
    if (!permitted[operation]) return;
    let path = `/admin/shipments/${snapshot.id}`;
    let body: unknown;
    if (operation === "pack") path += "/pack";
    else if (operation === "create") {
      if (!input || typeof input === "string") return;
      path += "/label";
      body = input;
    } else if (operation === "recover") {
      const remoteId =
        typeof input === "string" ? validateRecoveryId(input) : null;
      if (!remoteId) return;
      path += `/label/recover/${encodeURIComponent(remoteId)}`;
    } else if (operation === "checkout") {
      if (!validateExpectedCost(input) || input !== snapshot.label?.cost)
        return;
      path += "/label/checkout";
      body = { expectedCost: input };
    } else path += `/label/${operation === "print" ? "print" : operation}`;
    lock.current = true;
    setBusy(true);
    callbacks.current.onBusyChange(true);
    setPrintUrl(null);
    setError("");
    setNotice("");
    try {
      const result = await actionRequest<
        ShippingLabelDto | PackShipmentResult | LabelPrintResult
      >(path, operation === "print" ? "GET" : "POST", body);
      if (!valid() || selected.current !== snapshot.id) return;
      let url: string | null = null;
      if (operation === "print") {
        const printing = result as LabelPrintResult;
        url =
          printing?.mode === "private"
            ? safeLabelPrintUrl(printing.url, snapshot.label!.provider)
            : null;
        if (!url) throw new Error();
      } else if (operation === "pack") {
        const packed = result as PackShipmentResult;
        if (packed?.id !== snapshot.id || packed.packed !== true)
          throw new Error();
      } else if ((result as ShippingLabelDto)?.shipmentId !== snapshot.id)
        throw new Error();
      const fresh = await fetchDetail(snapshot.id);
      if (!fresh || !valid()) return;
      if (
        url &&
        fresh.label?.id === snapshot.label?.id &&
        fresh.label?.remoteId === snapshot.label?.remoteId &&
        fresh.label?.provider === snapshot.label?.provider &&
        labelActions(fresh, fresh.label).print
      )
        setPrintUrl(url);
      setNotice(noticeText[operation]);
    } catch (caught) {
      if (valid()) {
        setBlocked(true);
        fail(caught);
      }
    } finally {
      lock.current = false;
      if (alive.current) {
        setBusy(false);
        callbacks.current.onBusyChange(false);
      }
    }
  }
  return {
    queue,
    page,
    selectedId,
    detail,
    detailVersion,
    loading,
    checking,
    busy,
    blocked,
    denied,
    error,
    notice,
    printUrl,
    open,
    back,
    refreshDetail,
    run,
    changePage: (next: number) => {
      if (!lock.current && !selected.current) {
        setPage(next);
        setError("");
      }
    },
    refreshQueue: () => {
      if (!lock.current) {
        setError("");
        setQueueVersion((value) => value + 1);
      }
    },
  };
}
