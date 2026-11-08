import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  adminOrderError,
  fetchAdminOrder,
  fetchAdminOrders,
  validateAdminOrderFilters,
} from "./admin-orders";
import type {
  AdminOrderDetail,
  AdminOrderFilterDraft,
  AdminOrderFilters,
  AdminOrdersPage,
} from "./admin-orders";

const blank: AdminOrderFilterDraft = {
  status: "",
  orderNumber: "",
  customer: "",
  from: "",
  to: "",
};
type Validation = Partial<Record<keyof AdminOrderFilterDraft, string>>;
export interface AdminOrdersCallbacks {
  isCurrentSession: () => boolean;
  onOpenShipment?: (id: string) => void;
}

export function useAdminOrders(props: AdminOrdersCallbacks) {
  const [draft, setDraft] = useState<AdminOrderFilterDraft>(blank);
  const [filters, setFilters] = useState<AdminOrderFilters>({});
  const [validation, setValidation] = useState<Validation>({});
  const [page, setPage] = useState(1);
  const [list, setList] = useState<AdminOrdersPage | null>(null);
  const [detail, setDetail] = useState<AdminOrderDetail | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState<"list" | "detail" | null>("list");
  const [error, setError] = useState("");
  const [denied, setDenied] = useState(false);
  const alive = useRef(true);
  const revision = useRef(0);
  const read = useRef<AbortController | null>(null);
  const callbacks = useRef(props);
  useLayoutEffect(() => {
    callbacks.current = props;
  });
  const current = () => alive.current && callbacks.current.isCurrentSession();
  const available = () => current() && !denied;
  function begin() {
    read.current?.abort();
    const controller = new AbortController();
    read.current = controller;
    return { controller, started: ++revision.current };
  }
  function failure(caught: unknown) {
    if (!current()) return;
    setError(adminOrderError(caught));
    const status =
      caught && typeof caught === "object" && "status" in caught
        ? Number(caught.status)
        : undefined;
    if (status === 401 || status === 403) {
      setDenied(true);
      setList(null);
      setDetail(null);
      setSelectedId(null);
      setDraft(blank);
      setFilters({});
      setValidation({});
    }
  }
  async function loadList(query: AdminOrderFilters, nextPage: number) {
    if (!available()) return;
    const { controller, started } = begin();
    setFilters(query);
    setPage(nextPage);
    setSelectedId(null);
    setDetail(null);
    setList(null);
    setLoading("list");
    setError("");
    try {
      const result = await fetchAdminOrders(query, nextPage, controller);
      if (current() && revision.current === started) setList(result);
    } catch (caught) {
      if (revision.current === started) failure(caught);
    } finally {
      if (read.current === controller) read.current = null;
      if (current() && revision.current === started) setLoading(null);
    }
  }
  async function loadDetail(id: string) {
    if (!available()) return;
    const { controller, started } = begin();
    setSelectedId(id);
    setDetail(null);
    setLoading("detail");
    setError("");
    try {
      const result = await fetchAdminOrder(id, controller);
      if (current() && revision.current === started) setDetail(result);
    } catch (caught) {
      if (revision.current === started) failure(caught);
    } finally {
      if (read.current === controller) read.current = null;
      if (current() && revision.current === started) setLoading(null);
    }
  }
  useEffect(() => {
    alive.current = true;
    let active = true;
    void Promise.resolve().then(() => {
      if (active) return loadList({}, 1);
    });
    return () => {
      active = false;
      alive.current = false;
      // This counter invalidates asynchronous results and is not a DOM ref.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      revision.current++;
      read.current?.abort();
      read.current = null;
    };
    // One mounted report belongs to one session; callbacks and controllers use refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return {
    draft,
    validation,
    filters,
    page,
    list,
    detail,
    selectedId,
    loading,
    error,
    denied,
    changeDraft: (field: keyof AdminOrderFilterDraft, value: string) => {
      if (!available() || read.current) return;
      setDraft((previous) => ({ ...previous, [field]: value }));
      setValidation((previous) => ({ ...previous, [field]: undefined }));
    },
    apply: (): keyof AdminOrderFilterDraft | undefined => {
      if (!available() || read.current) return;
      const checked = validateAdminOrderFilters(draft);
      setValidation(checked.errors);
      if (!checked.query)
        return Object.keys(checked.errors)[0] as keyof AdminOrderFilterDraft;
      void loadList(checked.query, 1);
    },
    clear: () => {
      if (!available() || read.current) return;
      setDraft(blank);
      setValidation({});
      void loadList({}, 1);
    },
    refresh: () => {
      if (!available() || read.current) return;
      if (selectedId) void loadDetail(selectedId);
      else void loadList(filters, page);
    },
    changePage: (value: number) => {
      if (
        !available() ||
        read.current ||
        !list ||
        value < 1 ||
        value > Math.min(1_000_000, Math.ceil(list.total / 20))
      )
        return;
      void loadList(filters, value);
    },
    open: (id: string) => {
      if (
        available() &&
        !read.current &&
        list?.items.some((order) => order.id === id)
      )
        void loadDetail(id);
    },
    back: () => {
      if (available()) void loadList(filters, page);
    },
    openShipment: (id: string) => {
      if (
        available() &&
        !read.current &&
        detail?.shipments.some((shipment) => shipment.id === id)
      )
        callbacks.current.onOpenShipment?.(id);
    },
  };
}
