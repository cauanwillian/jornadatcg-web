import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  fetchStockMovements,
  movementError,
  validateMovementFilters,
} from "./stock-movements";
import type {
  MovementFilterDraft,
  MovementFilters,
  StockMovementsPage,
} from "./stock-movements";

export interface StockMovementsProps {
  isCurrentSession: () => boolean;
  initialProductId?: string;
}
const blank: MovementFilterDraft = { type: "", from: "", to: "" };
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function useStockMovements(props: StockMovementsProps) {
  const [initial] = useState<MovementFilters>(() =>
    props.initialProductId && uuid.test(props.initialProductId)
      ? { productId: props.initialProductId }
      : {},
  );
  const [draft, setDraft] = useState(blank);
  const [filters, setFilters] = useState<MovementFilters>(initial);
  const [validation, setValidation] = useState<
    Partial<Record<keyof MovementFilterDraft, string>>
  >({});
  const [list, setList] = useState<StockMovementsPage | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [denied, setDenied] = useState(false);
  const alive = useRef(true),
    revision = useRef(0),
    read = useRef<AbortController | null>(null);
  const callbacks = useRef(props);
  useLayoutEffect(() => {
    callbacks.current = props;
  });
  const current = () => alive.current && callbacks.current.isCurrentSession();
  const available = () => current() && !denied;
  async function load(query: MovementFilters, nextPage: number) {
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
      const result = await fetchStockMovements(query, nextPage, controller);
      if (current() && revision.current === started) setList(result);
    } catch (caught) {
      if (current() && revision.current === started) {
        setError(movementError(caught));
        const status =
          caught && typeof caught === "object" && "status" in caught
            ? Number(caught.status)
            : undefined;
        if (status === 401 || status === 403) {
          setDenied(true);
          setList(null);
          setDraft(blank);
          setFilters({});
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
      // This counter invalidates requests and does not point to a DOM node.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      revision.current++;
      read.current?.abort();
      read.current = null;
    };
    // The caller remounts this view when the account, session, or product link changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return {
    draft,
    filters,
    validation,
    list,
    page,
    loading,
    error,
    denied,
    changeDraft: (key: keyof MovementFilterDraft, value: string) => {
      if (available() && !read.current) {
        setDraft((previous) => ({ ...previous, [key]: value }));
        setValidation((previous) => ({ ...previous, [key]: undefined }));
      }
    },
    apply: (): keyof MovementFilterDraft | undefined => {
      if (!available() || read.current) return;
      const checked = validateMovementFilters(draft);
      setValidation(checked.errors);
      if (!checked.query)
        return Object.keys(checked.errors)[0] as keyof MovementFilterDraft;
      void load(
        {
          ...checked.query,
          ...(filters.productId ? { productId: filters.productId } : {}),
        },
        1,
      );
    },
    clear: () => {
      if (available() && !read.current) {
        setDraft(blank);
        setValidation({});
        void load(filters.productId ? { productId: filters.productId } : {}, 1);
      }
    },
    general: () => {
      if (available() && !read.current) {
        setDraft(blank);
        setValidation({});
        void load({}, 1);
      }
    },
    refresh: () => {
      if (available() && !read.current) void load(filters, page);
    },
    changePage: (nextPage: number) => {
      if (
        available() &&
        !read.current &&
        list &&
        Number.isInteger(nextPage) &&
        nextPage >= 1 &&
        nextPage <= Math.max(1, Math.min(1_000_000, Math.ceil(list.total / 20)))
      )
        void load(filters, nextPage);
    },
  };
}
