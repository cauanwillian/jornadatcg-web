import { useEffect, useRef, useState } from "react";
import { authorized } from "./session";

export const notificationKinds = {
  ORDER_CREATED: "Pedido criado",
  ORDER_PAID: "Pagamento do pedido confirmado",
  ORDER_CANCELLED: "Pedido cancelado",
  SHIPMENT_CREATED: "Envio solicitado",
  SHIPMENT_FREIGHT_PAID: "Pagamento do frete confirmado",
  SHIPMENT_PACKED: "Embalagem preparada",
  SHIPMENT_SHIPPED: "Envio postado",
  SHIPMENT_DELIVERED: "Envio entregue",
} as const;
export type NotificationKind = keyof typeof notificationKinds;
export interface NotificationTarget {
  type: "order" | "shipment";
  id: string;
}
export interface JourneyNotification {
  id: string;
  kind: NotificationKind;
  occurredAt: string;
  title: string;
  message: string;
  target: NotificationTarget;
  orderNumber?: number;
}
export interface NotificationsPage {
  items: JourneyNotification[];
  nextCursor: string | null;
  hasMore: boolean;
}

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;
export function validNotificationCursor(value: unknown): value is string {
  return (
    text(value, 512) &&
    value.trim() === value &&
    ![...value].some(
      (character) =>
        character.charCodeAt(0) < 32 ||
        character.charCodeAt(0) === 127 ||
        (character.length === 1 &&
          character.charCodeAt(0) >= 0xd800 &&
          character.charCodeAt(0) <= 0xdfff),
    )
  );
}
function validDate(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  )
    return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}
export function parseNotificationsPage(value: unknown): NotificationsPage {
  if (
    !object(value) ||
    !Array.isArray(value.items) ||
    value.items.length > 20 ||
    typeof value.hasMore !== "boolean" ||
    (value.hasMore
      ? !validNotificationCursor(value.nextCursor)
      : value.nextCursor !== null)
  ) {
    throw new Error("Resposta de notificações inválida.");
  }
  const items = value.items.map((item): JourneyNotification => {
    if (
      !object(item) ||
      typeof item.kind !== "string" ||
      !Object.hasOwn(notificationKinds, item.kind) ||
      !object(item.target) ||
      typeof item.target.id !== "string" ||
      !uuid.test(item.target.id) ||
      item.target.type !==
        (item.kind.startsWith("ORDER_") ? "order" : "shipment") ||
      item.id !== `${item.kind}:${item.target.id}` ||
      !validDate(item.occurredAt) ||
      !text(item.title, 200) ||
      !text(item.message, 1000) ||
      (item.orderNumber !== undefined &&
        (!Number.isSafeInteger(item.orderNumber) ||
          (item.orderNumber as number) <= 0))
    ) {
      throw new Error("Resposta de notificações inválida.");
    }
    return {
      id: item.id as string,
      kind: item.kind as NotificationKind,
      occurredAt: item.occurredAt,
      title: item.title,
      message: item.message,
      target: {
        type: item.target.type,
        id: item.target.id,
      } as NotificationTarget,
      ...(item.orderNumber !== undefined
        ? { orderNumber: item.orderNumber as number }
        : {}),
    };
  });
  return {
    items,
    hasMore: value.hasMore,
    nextCursor: value.nextCursor as string | null,
  };
}
export function mergeNotifications(
  previous: JourneyNotification[],
  incoming: JourneyNotification[],
) {
  return [
    ...new Map(
      [...previous, ...incoming].map((item) => [item.id, item]),
    ).values(),
  ].sort(
    (a, b) =>
      b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id),
  );
}

async function requestPage(cursor: string | null, controller: AbortController) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let onAbort = () => {};
  try {
    return parseNotificationsPage(
      await Promise.race([
        authorized<unknown>(
          `/notifications?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
          {
            method: "GET",
            cache: "no-store",
            signal: controller.signal,
          },
        ),
        new Promise<never>((_, reject) => {
          onAbort = () => reject(new Error("Consulta interrompida."));
          controller.signal.addEventListener("abort", onAbort, { once: true });
          timeout = setTimeout(() => {
            controller.abort();
            reject(new Error("Prazo da consulta encerrado."));
          }, 15000);
        }),
      ]),
    );
  } finally {
    clearTimeout(timeout);
    controller.signal.removeEventListener("abort", onAbort);
  }
}

export function useNotifications(
  isCurrentSession: () => boolean,
  onOpenTarget: (target: NotificationTarget) => Promise<void>,
) {
  const [page, setPage] = useState<NotificationsPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const [denied, setDenied] = useState(false);
  const refs = useRef({
    alive: true,
    revision: 0,
    loading: false,
    opening: false,
    controller: null as AbortController | null,
    page,
    denied: false,
    isCurrentSession,
    onOpenTarget,
  });
  refs.current.isCurrentSession = isCurrentSession;
  refs.current.onOpenTarget = onOpenTarget;
  const valid = () => refs.current.alive && refs.current.isCurrentSession();

  async function load(append: boolean) {
    const state = refs.current;
    if (
      !valid() ||
      state.opening ||
      state.denied ||
      (append && (state.loading || !state.page?.hasMore))
    )
      return;
    const cursor = append ? state.page!.nextCursor : null;
    state.controller?.abort();
    const controller = new AbortController();
    state.controller = controller;
    const revision = ++state.revision;
    state.loading = true;
    setLoading(true);
    setError("");
    if (!append) {
      state.page = null;
      setPage(null);
    }
    const current = () => valid() && revision === state.revision;
    try {
      const result = await requestPage(cursor, controller);
      if (!current()) return;
      if (append && result.hasMore && result.nextCursor === cursor)
        throw new Error("Cursor repetido.");
      const next = {
        ...result,
        items: mergeNotifications(
          append ? (state.page?.items ?? []) : [],
          result.items,
        ),
      };
      state.page = next;
      setPage(next);
    } catch (failure) {
      if (!current()) return;
      if ((failure as { status?: number } | null)?.status === 403) {
        state.denied = true;
        state.page = null;
        setDenied(true);
        setPage(null);
        setError(
          "Não foi possível acessar as notificações desta conta. Entre novamente.",
        );
      } else
        setError("Não foi possível carregar as notificações. Tente novamente.");
    } finally {
      if (current()) {
        state.loading = false;
        setLoading(false);
      }
    }
  }
  useEffect(() => {
    const state = refs.current;
    state.alive = true;
    void load(false);
    return () => {
      state.alive = false;
      state.revision++;
      state.controller?.abort();
    };
    // The feed belongs to this mounted session; callbacks stay current through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openTarget(target: NotificationTarget) {
    const state = refs.current;
    if (!valid() || state.opening || state.denied || state.loading) return;
    state.opening = true;
    setOpening(true);
    setError("");
    try {
      await state.onOpenTarget(target);
    } catch {
      if (valid())
        setError("Não foi possível abrir este detalhe. Tente novamente.");
    } finally {
      state.opening = false;
      if (valid()) setOpening(false);
    }
  }
  return {
    page: isCurrentSession() ? page : null,
    loading,
    opening,
    error,
    denied,
    refresh: () => void load(false),
    loadMore: () => void load(true),
    openTarget,
  };
}
