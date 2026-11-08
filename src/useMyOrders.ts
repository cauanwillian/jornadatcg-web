import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  cancelCustomerOrder,
  fetchCustomerOrders,
  inspectOrderCancellation,
  orderActionError,
} from "./customer-orders";
import type { CancellationReview } from "./customer-orders";
import type { Order } from "./purchase";

export interface MyOrdersCallbacks {
  onOpen: (order: Order) => void;
  isCurrentSession: () => boolean;
  onBusyChange: (busy: boolean) => void;
  onChanged?: () => void;
}
const status = (error: unknown) =>
  error && typeof error === "object" && "status" in error
    ? Number(error.status)
    : undefined;

export function useMyOrders(props: MyOrdersCallbacks) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const [selected, setSelected] = useState<Order | null>(null);
  const [review, setReview] = useState<CancellationReview | null>(null);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const alive = useRef(true);
  const mutation = useRef(false);
  const parentBusy = useRef(false);
  const reading = useRef(false);
  const revision = useRef(0);
  const read = useRef<AbortController | null>(null);
  const write = useRef<AbortController | null>(null);
  const lastPage = useRef(1);
  const attempted = useRef(new Set<string>());
  const notified = useRef(new Set<string>());
  const callbacks = useRef(props);
  useLayoutEffect(() => {
    callbacks.current = props;
  });
  const current = () => alive.current && callbacks.current.isCurrentSession();
  const available = () => current() && !mutation.current && !denied;

  function invalidateRead() {
    read.current?.abort();
    read.current = null;
    reading.current = false;
    return ++revision.current;
  }
  function releaseBusy() {
    if (!parentBusy.current) return;
    parentBusy.current = false;
    callbacks.current.onBusyChange(false);
  }
  function fail(caught: unknown, action: "list" | "review" | "cancel") {
    if (!current()) return;
    setError(orderActionError(caught, action));
    if ([401, 403].includes(status(caught) ?? 0)) {
      setDenied(true);
      setOrders([]);
      setSelected(null);
      setReview(null);
    }
  }
  function acknowledge(order: Order) {
    if (
      !current() ||
      order.status !== "CANCELLED" ||
      !attempted.current.has(order.id)
    )
      return;
    setNotice(
      `Pedido #${order.orderNumber} cancelado. A reserva das cartas foi liberada.`,
    );
    if (!notified.current.has(order.id)) {
      notified.current.add(order.id);
      callbacks.current.onChanged?.();
    }
  }
  function updateOrder(order: Order) {
    setOrders((previous) =>
      previous.map((row) => (row.id === order.id ? order : row)),
    );
    acknowledge(order);
  }
  async function load(nextPage: number) {
    if (!available() || reading.current || selected) return;
    const started = invalidateRead();
    const controller = new AbortController();
    read.current = controller;
    reading.current = true;
    lastPage.current = nextPage;
    setLoading(true);
    setError("");
    try {
      const result = await fetchCustomerOrders(nextPage, controller);
      if (!current() || started !== revision.current) return;
      setOrders((previous) => {
        if (nextPage === 1) return result.items;
        const incoming = new Map(
          result.items.map((order) => [order.id, order]),
        );
        const existing = new Set(previous.map((order) => order.id));
        return [
          ...previous.map((order) => incoming.get(order.id) ?? order),
          ...result.items.filter((order) => !existing.has(order.id)),
        ];
      });
      setPage(result.page);
      setTotal(result.total);
      result.items.forEach(acknowledge);
    } catch (caught) {
      if (started === revision.current) fail(caught, "list");
    } finally {
      if (read.current === controller) {
        read.current = null;
        reading.current = false;
      }
      if (current() && started === revision.current) setLoading(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    let active = true;
    void Promise.resolve().then(() => {
      if (active) return load(1);
    });
    return () => {
      active = false;
      alive.current = false;
      invalidateRead();
      write.current?.abort();
      releaseBusy();
    };
    // A mounted history belongs to one session; callbacks and requests use refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function inspect(order: Order) {
    if (!available() || reading.current) return;
    const started = invalidateRead();
    const controller = new AbortController();
    read.current = controller;
    reading.current = true;
    setSelected(order);
    setReview(null);
    setNeedsRefresh(false);
    setChecking(true);
    setError("");
    setNotice("");
    try {
      const result = await inspectOrderCancellation(order.id, controller);
      if (!current() || started !== revision.current) return;
      updateOrder(result.order);
      setSelected(result.order);
      setReview(result);
      if (
        result.order.status === "CANCELLED" &&
        !attempted.current.has(order.id)
      )
        setNotice("Este pedido já está cancelado.");
    } catch (caught) {
      if (started !== revision.current) return;
      fail(caught, "review");
      if (current()) setNeedsRefresh(true);
    } finally {
      if (read.current === controller) {
        read.current = null;
        reading.current = false;
      }
      if (current() && started === revision.current) setChecking(false);
    }
  }
  async function confirm() {
    if (
      !available() ||
      reading.current ||
      !review?.canCancel ||
      needsRefresh ||
      !selected ||
      review.order.id !== selected.id
    )
      return;
    const order = review.order;
    const started = invalidateRead();
    const controller = new AbortController();
    write.current = controller;
    mutation.current = true;
    parentBusy.current = true;
    attempted.current.add(order.id);
    setBusy(true);
    setError("");
    setNotice("");
    callbacks.current.onBusyChange(true);
    try {
      const result = await cancelCustomerOrder(order.id, controller);
      if (!current() || started !== revision.current) return;
      updateOrder(result);
      setSelected(result);
      setReview(null);
      setNeedsRefresh(false);
    } catch (caught) {
      if (!current() || started !== revision.current) return;
      setReview(null);
      setNeedsRefresh(true);
      fail(caught, "cancel");
    } finally {
      mutation.current = false;
      if (write.current === controller) write.current = null;
      if (current()) {
        setBusy(false);
        releaseBusy();
      }
    }
  }
  return {
    orders,
    total,
    loading,
    checking,
    busy,
    denied,
    selected,
    review,
    needsRefresh,
    error,
    notice,
    hasMore: page > 0 && page < Math.min(1_000_000, Math.ceil(total / 20)),
    refresh: () => {
      if (!reading.current) void load(1);
    },
    retry: () => {
      if (!reading.current) void load(lastPage.current);
    },
    more: () => {
      if (!reading.current && page < Math.min(1_000_000, Math.ceil(total / 20)))
        void load(page + 1);
    },
    inspect: (order: Order) => void inspect(order),
    recheck: () => {
      if (selected) void inspect(selected);
    },
    confirm,
    back: () => {
      if (!available()) return;
      invalidateRead();
      setSelected(null);
      setReview(null);
      setNeedsRefresh(false);
      setChecking(false);
      setError("");
    },
    open: (order: Order) => {
      if (available() && !reading.current && !selected)
        callbacks.current.onOpen(order);
    },
  };
}
