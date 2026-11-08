import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  cardError,
  fetchLocalCard,
  fetchLocalCards,
  importExternalCard,
  isImportableCard,
  searchExternalCards,
  validateCardSearch,
} from "./admin-cards";
import type { CardSearchDraft, ExternalCard } from "./admin-cards";
import type { LocalCard, LocalCardsPage } from "./admin-products";

type View = "local" | "external";
type SelectedCard = ExternalCard | LocalCard;
const status = (caught: unknown) =>
  caught && typeof caught === "object" && "status" in caught
    ? Number(caught.status)
    : undefined;
const emptySearch: CardSearchDraft = { name: "", code: "" };

export function useAdminCards(
  isCurrentSession: () => boolean,
  onBusyChange: (busy: boolean) => void,
) {
  const [view, setView] = useState<View>("local");
  const [local, setLocal] = useState<LocalCardsPage | null>(null);
  const [localDraft, setLocalDraft] = useState("");
  const [localName, setLocalName] = useState("");
  const [draft, setDraft] = useState(emptySearch);
  const [validation, setValidation] = useState<
    Partial<Record<"name" | "code" | "general", string>>
  >({});
  const [external, setExternal] = useState<ExternalCard[] | null>(null);
  const [externalPage, setExternalPage] = useState(1);
  const [selected, setSelected] = useState<SelectedCard | null>(null);
  const [loading, setLoading] = useState<"list" | "detail" | "search" | null>(
    "list",
  );
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const alive = useRef(true);
  const mutation = useRef(false);
  const revision = useRef(0);
  const read = useRef<AbortController | null>(null);
  const write = useRef<AbortController | null>(null);
  const callbacks = useRef({ isCurrentSession, onBusyChange });
  useLayoutEffect(() => {
    callbacks.current = { isCurrentSession, onBusyChange };
  }, [isCurrentSession, onBusyChange]);
  const current = () => alive.current && callbacks.current.isCurrentSession();
  const available = () => current() && !mutation.current && !denied;

  function invalidateRead() {
    read.current?.abort();
    return ++revision.current;
  }
  function fail(caught: unknown, action: "local" | "search" | "import") {
    if (!current()) return;
    setError(cardError(caught, action));
    if ([401, 403].includes(status(caught) ?? 0)) {
      setDenied(true);
      setSelected(null);
      setLocal(null);
      setExternal(null);
    }
  }
  async function loadLocal(page: number, name: string) {
    if (!available()) return;
    const started = invalidateRead();
    const controller = new AbortController();
    read.current = controller;
    setLoading("list");
    setSelected(null);
    setError("");
    setNotice("");
    setLocal(null);
    try {
      const data = await fetchLocalCards(
        { page, ...(name ? { name } : {}) },
        controller,
      );
      if (!current() || started !== revision.current) return;
      setLocal(data);
      setLocalName(name);
    } catch (caught) {
      if (started === revision.current) fail(caught, "local");
    } finally {
      if (current() && started === revision.current) setLoading(null);
    }
  }
  useEffect(() => {
    alive.current = true;
    let active = true;
    void Promise.resolve().then(() => {
      if (active) return loadLocal(1, "");
    });
    return () => {
      active = false;
      alive.current = false;
      invalidateRead();
      write.current?.abort();
      if (mutation.current) callbacks.current.onBusyChange(false);
    };
    // Each mounted panel belongs to a single session; callbacks and requests use refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function changeView(next: View) {
    if (!available() || next === view) return;
    invalidateRead();
    setLoading(null);
    setSelected(null);
    setView(next);
    setError("");
    setNotice("");
    setUncertain(false);
    if (next === "local") void loadLocal(1, localName);
  }
  async function search() {
    if (!available() || loading) return;
    const checked = validateCardSearch(draft);
    setValidation(checked.errors);
    if (!checked.query) return;
    const started = invalidateRead();
    const controller = new AbortController();
    read.current = controller;
    setExternal(null);
    setSelected(null);
    setLoading("search");
    setError("");
    setNotice("");
    try {
      const result = await searchExternalCards(checked.query, controller);
      if (!current() || started !== revision.current) return;
      setExternal(result);
      setExternalPage(1);
    } catch (caught) {
      if (started === revision.current) fail(caught, "search");
    } finally {
      if (current() && started === revision.current) setLoading(null);
    }
  }
  async function openLocal(id: string) {
    if (!available() || loading) return;
    const started = invalidateRead();
    const controller = new AbortController();
    read.current = controller;
    setLoading("detail");
    setError("");
    setNotice("");
    try {
      const card = await fetchLocalCard(id, controller);
      if (current() && started === revision.current) setSelected(card);
    } catch (caught) {
      if (started === revision.current) fail(caught, "local");
    } finally {
      if (current() && started === revision.current) setLoading(null);
    }
  }
  async function importCard() {
    if (
      !available() ||
      loading ||
      !selected ||
      "id" in selected ||
      !isImportableCard(selected.externalId)
    )
      return;
    const card = selected;
    const started = invalidateRead();
    const controller = new AbortController();
    write.current = controller;
    mutation.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    callbacks.current.onBusyChange(true);
    try {
      const result = await importExternalCard(card.externalId, controller);
      if (!current() || started !== revision.current) return;
      setSelected(result);
      setUncertain(false);
      setNotice("Carta disponível na biblioteca.");
    } catch (caught) {
      if (!current() || started !== revision.current) return;
      fail(caught, "import");
      const code = status(caught);
      setUncertain(code === undefined || code === 408 || code >= 500);
    } finally {
      mutation.current = false;
      if (write.current === controller) write.current = null;
      if (current()) {
        setBusy(false);
        callbacks.current.onBusyChange(false);
      }
    }
  }
  const totalExternalPages = Math.max(
    1,
    Math.ceil((external?.length ?? 0) / 12),
  );
  return {
    view,
    local,
    localDraft,
    localName,
    draft,
    validation,
    external,
    externalRows:
      external?.slice((externalPage - 1) * 12, externalPage * 12) ?? [],
    externalPage,
    totalExternalPages,
    selected,
    loading,
    busy,
    denied,
    error,
    notice,
    uncertain,
    changeView,
    search,
    openLocal,
    importCard,
    changeLocalDraft: (value: string) => {
      if (available() && !loading) setLocalDraft(value);
    },
    filterLocal: () => {
      if (!available() || loading) return;
      if (
        localDraft.length > 200 ||
        Array.from(localDraft).some(
          (character) =>
            character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        )
      ) {
        setError("Informe um nome com até 200 caracteres válidos.");
        return;
      }
      void loadLocal(1, localDraft.trim());
    },
    reloadLocal: () => {
      if (!loading) void loadLocal(local?.pagination.page ?? 1, localName);
    },
    changeLocalPage: (page: number) => {
      if (
        !loading &&
        local &&
        page >= 1 &&
        page <= Math.min(10000, local.pagination.totalPages)
      )
        void loadLocal(page, localName);
    },
    changeDraft: (field: keyof CardSearchDraft, value: string) => {
      if (available() && !loading) {
        setDraft((previous) => ({ ...previous, [field]: value }));
        setValidation({});
      }
    },
    changeExternalPage: (page: number) => {
      if (available() && !loading && page >= 1 && page <= totalExternalPages)
        setExternalPage(page);
    },
    review: (card: ExternalCard) => {
      if (available() && !loading) {
        setSelected(card);
        setError("");
        setNotice("");
        setUncertain(false);
      }
    },
    back: () => {
      if (available()) {
        setSelected(null);
        setError("");
        setNotice("");
        setUncertain(false);
      }
    },
    canNavigate: available,
  };
}
