import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  fetchInventory,
  inventoryError,
  validateInventoryFilters,
} from "./admin-inventory";
import type {
  InventoryFilterDraft,
  InventoryFilters,
  InventoryPage,
} from "./admin-inventory";

const blank: InventoryFilterDraft = {
  name: "",
  active: "",
  stock: "",
  lowStockThreshold: "5",
};
const initial: InventoryFilters = { lowStockThreshold: 5 };
export interface InventoryCallbacks {
  isCurrentSession: () => boolean;
  onOpenProduct?: (id: string) => void;
  onOpenHistory?: (id: string) => void;
}

export function useAdminInventory(props: InventoryCallbacks) {
  const [draft, setDraft] = useState<InventoryFilterDraft>(blank);
  const [filters, setFilters] = useState<InventoryFilters>(initial);
  const [validation, setValidation] = useState<
    Partial<Record<keyof InventoryFilterDraft, string>>
  >({});
  const [page, setPage] = useState(1);
  const [list, setList] = useState<InventoryPage | null>(null);
  const [loading, setLoading] = useState(true);
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

  async function load(query: InventoryFilters, nextPage: number) {
    if (!available()) return;
    read.current?.abort();
    const controller = new AbortController();
    read.current = controller;
    const started = ++revision.current;
    setFilters(query);
    setPage(nextPage);
    setList(null);
    setLoading(true);
    setError("");
    try {
      const result = await fetchInventory(query, nextPage, controller);
      if (current() && revision.current === started) setList(result);
    } catch (caught) {
      if (current() && revision.current === started) {
        const status =
          caught && typeof caught === "object" && "status" in caught
            ? Number(caught.status)
            : undefined;
        setError(inventoryError(caught));
        if (status === 401 || status === 403) {
          setDenied(true);
          setList(null);
          setDraft(blank);
          setFilters(initial);
          setValidation({});
        }
      }
    } finally {
      if (read.current === controller) read.current = null;
      if (current() && revision.current === started) setLoading(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    let active = true;
    void Promise.resolve().then(() => {
      if (active) return load(initial, 1);
    });
    return () => {
      active = false;
      alive.current = false;
      // This counter invalidates requests and is not a DOM ref.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      revision.current++;
      read.current?.abort();
      read.current = null;
    };
    // The caller remounts the panel when the account or session changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return {
    draft,
    filters,
    validation,
    page,
    list,
    loading,
    error,
    denied,
    changeDraft: (field: keyof InventoryFilterDraft, value: string) => {
      if (!available() || read.current) return;
      setDraft((previous) => ({ ...previous, [field]: value }));
      setValidation((previous) => ({ ...previous, [field]: undefined }));
    },
    apply: (): keyof InventoryFilterDraft | undefined => {
      if (!available() || read.current) return;
      const result = validateInventoryFilters(draft);
      setValidation(result.errors);
      if (!result.query)
        return Object.keys(result.errors)[0] as keyof InventoryFilterDraft;
      void load(result.query, 1);
    },
    clear: () => {
      if (!available() || read.current) return;
      setDraft(blank);
      setValidation({});
      void load(initial, 1);
    },
    refresh: () => {
      if (available() && !read.current) void load(filters, page);
    },
    changePage: (nextPage: number) => {
      if (
        !available() ||
        read.current ||
        !list ||
        !Number.isInteger(nextPage) ||
        nextPage < 1 ||
        nextPage > Math.max(1, Math.min(1_000_000, Math.ceil(list.total / 20)))
      )
        return;
      void load(filters, nextPage);
    },
    openProduct: (id: string) => {
      if (
        available() &&
        !read.current &&
        list?.items.some((item) => item.id === id)
      )
        callbacks.current.onOpenProduct?.(id);
    },
    openHistory: (id: string) => {
      if (
        available() &&
        !read.current &&
        list?.items.some((item) => item.id === id)
      )
        callbacks.current.onOpenHistory?.(id);
    },
  };
}
