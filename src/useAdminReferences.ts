import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createReference, fetchReferenceOptions } from "./admin-references";
import type { ReferenceInput, ReferenceKind } from "./admin-references";
import type { ProductOptions } from "./admin-products";

const status = (error: unknown) =>
  error && typeof error === "object" && "status" in error
    ? Number(error.status)
    : undefined;
const labels: Record<ReferenceKind, string> = {
  category: "Categoria",
  condition: "Condição",
  language: "Idioma",
};
const collection = {
  category: "categories",
  condition: "conditions",
  language: "languages",
} as const;
const conflict =
  "Não foi possível cadastrar: o nome da categoria, seu identificador ou o código informado pode já estar em uso, inclusive em um cadastro inativo que não aparece nesta lista. Confira os dados antes de tentar novamente.";
function failure(error: unknown, writing: boolean) {
  switch (status(error)) {
    case 401:
      return "Sua sessão expirou. Entre novamente com uma conta de administrador.";
    case 403:
      return "Acesso restrito a administradores. Entre com uma conta autorizada.";
    case 400:
      return "Confira os campos informados e corrija o cadastro antes de salvar novamente.";
    case 409:
      return conflict;
    default:
      return writing
        ? "Não foi possível confirmar o cadastro. Ele pode ter sido concluído. Atualize a lista e confira o resultado antes de tentar novamente."
        : "Não foi possível carregar os cadastros da loja. Atualize a lista para tentar novamente.";
  }
}

export function useAdminReferences(
  isCurrentSession: () => boolean,
  onBusyChange: (busy: boolean) => void,
  onChanged?: () => void,
) {
  const [options, setOptions] = useState<ProductOptions | null>(null);
  const [kind, setKind] = useState<ReferenceKind>("category");
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<{
    kind: ReferenceKind;
    identifier: string;
  } | null>(null);
  const [reviewReady, setReviewReady] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const alive = useRef(true);
  const lock = useRef(false);
  const revision = useRef(0);
  const read = useRef<AbortController | null>(null);
  const write = useRef<AbortController | null>(null);
  const uncertain = useRef<{ kind: ReferenceKind; identifier: string } | null>(
    null,
  );
  const callbacks = useRef({ isCurrentSession, onBusyChange, onChanged });
  useLayoutEffect(() => {
    callbacks.current = { isCurrentSession, onBusyChange, onChanged };
  }, [isCurrentSession, onBusyChange, onChanged]);
  const current = () => alive.current && callbacks.current.isCurrentSession();

  function fail(caught: unknown, writing = false) {
    if (!current()) return;
    setError(failure(caught, writing));
    setBlocked(true);
    if ([401, 403].includes(status(caught) ?? 0)) {
      setOptions(null);
      setCreating(false);
      setPending(null);
      setDenied(true);
    }
  }
  async function load(manual = false) {
    if (!current() || lock.current || denied) return;
    read.current?.abort();
    const controller = new AbortController();
    read.current = controller;
    const started = ++revision.current;
    setCreating(false);
    setLoading(true);
    setBlocked(true);
    setError("");
    setNotice("");
    setReviewed(false);
    setReviewReady(false);
    try {
      const data = await fetchReferenceOptions(controller);
      if (!current() || revision.current !== started) return;
      setOptions(data);
      setPage(1);
      setBlocked(false);
      if (manual && uncertain.current) setReviewReady(true);
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
    if (lock.current) callbacks.current.onBusyChange(false);
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
    // One mount owns this account's feed; the current callbacks/controllers are kept in refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(input: ReferenceInput) {
    if (
      !current() ||
      lock.current ||
      loading ||
      blocked ||
      denied ||
      !creating ||
      !options ||
      uncertain.current
    )
      return;
    const snapshot = kind;
    const controller = new AbortController();
    write.current = controller;
    lock.current = true;
    revision.current++;
    read.current?.abort();
    setBusy(true);
    callbacks.current.onBusyChange(true);
    setError("");
    setNotice("");
    let confirmed = false;
    try {
      await createReference(snapshot, input, controller);
      confirmed = true;
      if (!current()) return;
      setCreating(false);
      // The mutation is confirmed even if the following canonical read fails.
      callbacks.current.onChanged?.();
      const refresh = new AbortController();
      read.current = refresh;
      const data = await fetchReferenceOptions(refresh);
      if (!current()) return;
      setOptions(data);
      setPage(1);
      setFilter("");
      setBlocked(false);
      setNotice(
        snapshot === "language"
          ? "Idioma cadastrado."
          : `${labels[snapshot]} cadastrada.`,
      );
    } catch (caught) {
      if (!current()) return;
      const code = status(caught);
      if (!confirmed && code === 400) {
        setError(failure(caught, true));
        return;
      }
      if (!confirmed && code === 409) {
        // A conflict is a definitive rejection. Refresh once without repeating the POST.
        const refresh = new AbortController();
        read.current = refresh;
        try {
          const data = await fetchReferenceOptions(refresh);
          if (!current()) return;
          setOptions(data);
          setBlocked(false);
          setError(conflict);
        } catch (readError) {
          if (!current()) return;
          setCreating(false);
          fail(readError);
        }
        return;
      }
      setCreating(false);
      setReviewed(false);
      setReviewReady(false);
      if (!confirmed && (code === undefined || code >= 500 || code === 408)) {
        const last = {
          kind: snapshot,
          identifier: input.slug ?? input.code ?? "",
        };
        uncertain.current = last;
        setPending(last);
      }
      fail(caught, !confirmed);
      if (confirmed && ![401, 403].includes(code ?? 0))
        setError(
          "O cadastro foi recebido, mas não foi possível atualizar a lista. Atualize os cadastros antes de continuar.",
        );
    } finally {
      lock.current = false;
      if (write.current === controller) write.current = null;
      if (current()) {
        setBusy(false);
        callbacks.current.onBusyChange(false);
      }
    }
  }
  const fold = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("pt-BR");
  const rows = options?.[collection[kind]] ?? [];
  const term = fold(filter.trim());
  const filtered = rows.filter((row) =>
    fold(`${row.name} ${"slug" in row ? row.slug : row.code}`).includes(term),
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / 12));
  const currentPage = Math.min(page, totalPages);
  return {
    save,
    options,
    kind,
    filter,
    creating,
    loading,
    busy,
    blocked,
    denied,
    error,
    notice,
    pending,
    reviewReady,
    reviewed,
    rows: filtered.slice((currentPage - 1) * 12, currentPage * 12),
    total: rows.length,
    filteredTotal: filtered.length,
    page: currentPage,
    totalPages,
    refresh: () => void load(true),
    changeKind: (value: ReferenceKind) => {
      if (!current() || lock.current || creating) return;
      setKind(value);
      setFilter("");
      setPage(1);
      setError("");
      setNotice("");
    },
    changeFilter: (value: string) => {
      if (current() && !lock.current && !creating) {
        setFilter(value);
        setPage(1);
      }
    },
    changePage: (value: number) => {
      if (
        current() &&
        !lock.current &&
        !creating &&
        value >= 1 &&
        value <= totalPages
      )
        setPage(value);
    },
    openCreate: () => {
      if (
        current() &&
        !lock.current &&
        !loading &&
        !blocked &&
        !denied &&
        options &&
        !uncertain.current
      ) {
        setCreating(true);
        setError("");
        setNotice("");
      }
    },
    cancel: () => {
      if (current() && !lock.current) {
        setCreating(false);
        setError("");
      }
    },
    setReviewed: (value: boolean) => {
      if (current() && reviewReady && !lock.current && !loading)
        setReviewed(value);
    },
    releaseCreate: () => {
      if (!current() || lock.current || blocked || !reviewReady || !reviewed)
        return;
      uncertain.current = null;
      setPending(null);
      setReviewed(false);
      setReviewReady(false);
      setNotice(
        "Conferência registrada. Cadastre novamente somente se a opção ainda não existir.",
      );
    },
  };
}
