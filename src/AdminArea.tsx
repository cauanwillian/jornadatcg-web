import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { FormEvent } from "react";
import { authorized } from "./session";
import { money } from "./api";
import { ProductEditor } from "./AdminProductEditor";
import { changedProductFields, validateStock } from "./admin-products";
import type {
  AdminProduct,
  AdminProductsPage,
  ProductInput,
  ProductOptions,
} from "./admin-products";

const StockEntryForm = lazy(() =>
  import("./StockEntryForm").then((module) => ({
    default: module.StockEntryForm,
  })),
);

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function pendingCreation(key: string) {
  try {
    const value = sessionStorage.getItem(key);
    if (value && !uuid.test(value)) throw new Error();
    return { cardId: value, blocked: false };
  } catch {
    return { cardId: null, blocked: true };
  }
}
const status = (error: unknown): number | undefined =>
  error && typeof error === "object" && "status" in error
    ? Number(error.status)
    : undefined;
function message(error: unknown) {
  switch (status(error)) {
    case 400:
      return "Confira os dados informados e tente novamente.";
    case 401:
      return "Sua sessão expirou. Entre novamente.";
    case 403:
      return "Acesso restrito a administradores.";
    case 404:
      return "Produto não encontrado. Atualize a lista.";
    case 409:
      return "Os dados foram alterados por outra operação. Atualize o produto antes de tentar novamente.";
    default:
      return "Não foi possível concluir a operação. Consulte os dados atualizados antes de tentar novamente.";
  }
}

export function AdminPanel({
  userId,
  initialProductId,
  onOpenHistory,
  isCurrentSession,
  onBusyChange,
  onChanged,
}: {
  userId: string;
  initialProductId?: string;
  onOpenHistory?: (id: string) => void;
  isCurrentSession: () => boolean;
  onBusyChange: (busy: boolean) => void;
  onChanged?: () => void;
}) {
  const [initialId] = useState(() =>
    initialProductId && uuid.test(initialProductId) ? initialProductId : null,
  );
  const guardKey = `jornada-admin-product:${userId}`;
  const [stored] = useState(() => pendingCreation(guardKey));
  const [pendingCard, setPendingCard] = useState(stored.cardId);
  const [storageBlocked, setStorageBlocked] = useState(stored.blocked);
  const [creationReviewed, setCreationReviewed] = useState(false);
  const [view, setView] = useState<"list" | "new" | "detail" | "edit">(
    initialId ? "detail" : "list",
  );
  const [list, setList] = useState<AdminProductsPage | null>(null);
  const [options, setOptions] = useState<ProductOptions | null>(null);
  const [optionsError, setOptionsError] = useState("");
  const [optionsVersion, setOptionsVersion] = useState(0);
  const [term, setTerm] = useState("");
  const [active, setActive] = useState("");
  const [filter, setFilter] = useState({ name: "", active: "", cardId: "" });
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(Boolean(initialId));
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const [current, setCurrent] = useState<AdminProduct | null>(null);
  const [selectedId, setSelectedId] = useState(initialId ?? "");
  const [stale, setStale] = useState(Boolean(initialId));
  const [stock, setStock] = useState("");
  const [stockReason, setStockReason] = useState("");
  const [stockReview, setStockReview] = useState<number | null>(null);
  const [showEntry, setShowEntry] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const alive = useRef(true);
  const lock = useRef(false);
  const reads = useRef(0);
  const detailRequest = useRef<AbortController | null>(null);
  const mutationRequest = useRef<AbortController | null>(null);
  const callbacks = useRef({ isCurrentSession, onBusyChange, onChanged });
  useLayoutEffect(() => {
    callbacks.current = { isCurrentSession, onBusyChange, onChanged };
  }, [isCurrentSession, onBusyChange, onChanged]);
  const valid = () => alive.current && callbacks.current.isCurrentSession();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      detailRequest.current?.abort();
      mutationRequest.current?.abort();
      if (lock.current) callbacks.current.onBusyChange(false);
    };
  }, []);
  function fail(caught: unknown) {
    if (!valid()) return;
    if (status(caught) === 403) {
      setDenied(true);
      setCurrent(null);
      setList(null);
    }
    setError(message(caught));
  }
  useEffect(() => {
    let activeRead = true;
    const controller = new AbortController();
    const load = async () => {
      setOptionsError("");
      try {
        const data = await authorized<ProductOptions>("/products/options", {
          signal: controller.signal,
          cache: "no-store",
        });
        if (activeRead && valid()) setOptions(data);
      } catch (caught) {
        if (activeRead && valid()) {
          if (status(caught) === 403) fail(caught);
          else
            setOptionsError(
              "Não foi possível carregar categorias, condições e idiomas.",
            );
        }
      }
    };
    void load();
    return () => {
      activeRead = false;
      controller.abort();
    };
  }, [optionsVersion]);
  useEffect(() => {
    if (view !== "list" || denied) return;
    let activeRead = true;
    const controller = new AbortController();
    const query = new URLSearchParams({ page: String(page), limit: "12" });
    if (filter.name) query.set("name", filter.name);
    if (filter.active) query.set("active", filter.active);
    if (filter.cardId) query.set("cardId", filter.cardId);
    const load = async () => {
      setLoading(true);
      setList(null);
      setCreationReviewed(false);
      try {
        const data = await authorized<AdminProductsPage>(`/products?${query}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (activeRead && valid()) {
          setList(data);
          if (pendingCard && filter.cardId === pendingCard)
            setCreationReviewed(true);
        }
      } catch (caught) {
        if (activeRead) fail(caught);
      } finally {
        if (activeRead && valid()) setLoading(false);
      }
    };
    void load();
    return () => {
      activeRead = false;
      controller.abort();
    };
  }, [view, filter, page, version, denied, pendingCard]);

  function markBusy(value: boolean) {
    lock.current = value;
    setBusy(value);
    callbacks.current.onBusyChange(value);
  }
  function back() {
    if (lock.current) return;
    reads.current++;
    detailRequest.current?.abort();
    setChecking(false);
    setView("list");
    setCurrent(null);
    setError("");
    setStockReview(null);
    setShowEntry(false);
  }
  async function loadProduct(id: string) {
    if (lock.current || !valid()) return;
    detailRequest.current?.abort();
    const revision = ++reads.current;
    const controller = new AbortController();
    detailRequest.current = controller;
    setSelectedId(id);
    setView("detail");
    setCurrent(null);
    setStockReview(null);
    setShowEntry(false);
    setChecking(true);
    setStale(true);
    setError("");
    try {
      const product = await authorized<AdminProduct>(`/products/${id}`, {
        signal: controller.signal,
        cache: "no-store",
      });
      if (valid() && reads.current === revision) {
        setCurrent(product);
        setStock(String(product.inventory?.availableQuantity ?? ""));
        setStockReason("");
        setStale(false);
      }
    } catch (caught) {
      if (reads.current === revision) fail(caught);
    } finally {
      if (valid() && reads.current === revision) setChecking(false);
    }
  }
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active && initialId && valid()) return loadProduct(initialId);
    });
    return () => {
      active = false;
    };
    // A product link is consumed once; a different link remounts the panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function changed() {
    setVersion((value) => value + 1);
    callbacks.current.onChanged?.();
  }
  function recordedEntry() {
    if (!valid() || lock.current || !current) return;
    setNotice("Entrada de estoque registrada. O saldo foi atualizado.");
    setStockReview(null);
    setShowEntry(false);
    changed();
    void loadProduct(current.id);
  }
  function clearCreation() {
    sessionStorage.removeItem(guardKey);
    setPendingCard(null);
    setCreationReviewed(false);
  }
  async function writeProduct(
    path: string,
    method: "POST" | "PATCH",
    body: unknown,
  ) {
    const controller = new AbortController();
    mutationRequest.current = controller;
    const interrupted = new Promise<never>((_, reject) => {
      controller.signal.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true },
      );
    });
    const timer = window.setTimeout(() => controller.abort(), 15_000);
    try {
      return await Promise.race([
        authorized<AdminProduct>(path, {
          method,
          body: JSON.stringify(body),
          signal: controller.signal,
        }),
        interrupted,
      ]);
    } finally {
      window.clearTimeout(timer);
      if (mutationRequest.current === controller)
        mutationRequest.current = null;
    }
  }
  async function save(input: ProductInput): Promise<boolean> {
    if (lock.current || !valid() || denied || checking) return false;
    const creating = view === "new";
    if (creating && (pendingCard || storageBlocked)) return false;
    if (!creating && (!current || stale || view !== "edit")) return false;
    const fields = creating ? input : changedProductFields(current!, input);
    if (!creating && !Object.keys(fields).length) {
      setNotice("Nenhuma alteração no anúncio.");
      setView("detail");
      return true;
    }
    if (creating) {
      try {
        sessionStorage.setItem(guardKey, input.cardId);
        if (sessionStorage.getItem(guardKey) !== input.cardId)
          throw new Error();
        setPendingCard(input.cardId);
      } catch {
        setStorageBlocked(true);
        setError(
          "Não foi possível proteger esta tentativa no navegador. Consulte os anúncios antes de cadastrar por outra aba.",
        );
        return false;
      }
    }
    markBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await writeProduct(
        creating ? "/products" : `/products/${current!.id}`,
        creating ? "POST" : "PATCH",
        fields,
      );
      if (!valid()) return false;
      if (
        !result?.id ||
        !uuid.test(result.id) ||
        (!creating && result.id !== current!.id)
      )
        throw new Error();
      if (creating) clearCreation();
      setCurrent(result);
      setSelectedId(result.id);
      setStock(String(result.inventory?.availableQuantity ?? ""));
      setStale(false);
      setView("detail");
      setNotice(creating ? "Produto cadastrado." : "Anúncio atualizado.");
      changed();
      return true;
    } catch (caught) {
      if (!valid()) return false;
      if (creating) {
        if ([400, 401, 403, 404, 409].includes(status(caught) ?? 0)) {
          try {
            clearCreation();
          } catch {
            setStorageBlocked(true);
          }
          fail(caught);
        } else {
          setView("list");
          setError(
            "Não foi possível confirmar o cadastro. O produto pode ter sido criado. Confira os anúncios desta carta antes de tentar novamente.",
          );
        }
      } else {
        setStale(true);
        setView("detail");
        fail(caught);
      }
      return false;
    } finally {
      if (alive.current) markBusy(false);
    }
  }
  function reviewStock(event: FormEvent) {
    event.preventDefault();
    if (lock.current || checking || stale || !current?.inventory || !valid())
      return;
    const quantity = validateStock(stock);
    if (quantity === null) {
      setError("Informe um estoque disponível inteiro entre 0 e 2147483647.");
      return;
    }
    if (quantity === current.inventory.availableQuantity) {
      setError(
        "A quantidade informada já é a disponível. Não há alteração para salvar.",
      );
      return;
    }
    if (
      stockReason &&
      (stockReason.trim().length < 3 ||
        stockReason.length > 500 ||
        Array.from(stockReason).some(
          (character) =>
            character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        ))
    ) {
      setError(
        "Informe um motivo entre 3 e 500 caracteres válidos ou deixe o campo vazio.",
      );
      return;
    }
    setError("");
    setStockReview(quantity);
  }
  async function saveStock() {
    if (
      lock.current ||
      checking ||
      stale ||
      stockReview === null ||
      !current?.inventory ||
      !valid()
    )
      return;
    const snapshot = current;
    markBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await writeProduct(
        `/products/${snapshot.id}/inventory`,
        "PATCH",
        {
          expectedAvailableQuantity: snapshot.inventory!.availableQuantity,
          availableQuantity: stockReview,
          ...(stockReason.trim() ? { reason: stockReason.trim() } : {}),
        },
      );
      if (!valid()) return;
      if (result?.id !== snapshot.id || !result.inventory) throw new Error();
      setCurrent(result);
      setStock(String(result.inventory.availableQuantity));
      setStockReview(null);
      setStockReason("");
      setNotice("Estoque disponível atualizado.");
      changed();
    } catch (caught) {
      if (valid()) {
        setStale(true);
        setStockReview(null);
        fail(caught);
      }
    } finally {
      if (alive.current) markBusy(false);
    }
  }
  function search(event: FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    if (term.length > 200) {
      setError("Pesquise um nome com até 200 caracteres.");
      return;
    }
    setFilter({ name: term.trim(), active, cardId: "" });
    setPage(1);
    setError("");
  }

  if (denied)
    return (
      <p className="error" role="alert">
        Acesso restrito a administradores. Entre com uma conta autorizada.
      </p>
    );
  return (
    <section className="admin-area" aria-label="Gestão de produtos">
      <p className="muted">
        Gerencie anúncios, destaques e unidades disponíveis da loja.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="auth-success" role="status">
          {notice}
        </p>
      )}
      {storageBlocked && (
        <p className="error" role="alert">
          Não foi possível ler a proteção de cadastro neste navegador. A criação
          está bloqueada; consulte os anúncios existentes antes de usar outra
          aba.
        </p>
      )}
      {pendingCard && (
        <aside className="admin-recovery" aria-label="Conferência de cadastro">
          <p>
            Uma criação de produto ainda precisa ser conferida. Ela pode ter
            sido concluída.
          </p>
          <button
            className="outline"
            disabled={busy || checking}
            onClick={() => {
              back();
              setFilter({ name: "", active: "", cardId: pendingCard });
              setPage(1);
              setVersion((value) => value + 1);
            }}
          >
            Conferir anúncios da carta
          </button>
          {creationReviewed && list && filter.cardId === pendingCard && (
            <>
              <p>
                Confira todos os anúncios e páginas abaixo. Libere um novo
                cadastro somente se ele for necessário.
              </p>
              <button
                className="clear"
                disabled={busy || loading || view !== "list"}
                onClick={() => {
                  try {
                    clearCreation();
                    setNotice(
                      "Proteção liberada após a conferência. Um novo cadastro exige nova confirmação.",
                    );
                  } catch {
                    setStorageBlocked(true);
                  }
                }}
              >
                Liberar novo cadastro
              </button>
            </>
          )}
        </aside>
      )}
      {optionsError && (
        <div role="alert">
          <p className="error">{optionsError}</p>
          <button
            className="clear"
            disabled={busy}
            onClick={() => setOptionsVersion((value) => value + 1)}
          >
            Atualizar opções
          </button>
        </div>
      )}
      {view === "list" ? (
        <>
          <div className="admin-toolbar">
            <form className="admin-filter" onSubmit={search}>
              <label>
                Nome da carta
                <input
                  value={term}
                  maxLength={200}
                  onChange={(event) => setTerm(event.target.value)}
                />
              </label>
              <label>
                Status do anúncio
                <select
                  value={active}
                  onChange={(event) => setActive(event.target.value)}
                >
                  <option value="">Todos</option>
                  <option value="true">Ativos</option>
                  <option value="false">Inativos</option>
                </select>
              </label>
              <button className="outline" disabled={busy}>
                Filtrar produtos
              </button>
            </form>
            <button
              className="primary"
              disabled={busy || !options || !!pendingCard || storageBlocked}
              onClick={() => {
                setView("new");
                setError("");
                setNotice("");
              }}
            >
              Novo produto
            </button>
          </div>
          <button
            className="clear"
            disabled={busy || loading}
            onClick={() => {
              setError("");
              setVersion((value) => value + 1);
            }}
          >
            Atualizar produtos
          </button>
          {loading ? (
            <p role="status">Carregando produtos…</p>
          ) : list ? (
            <>
              <p className="muted">
                {list.pagination.total} anúncios encontrados
                {filter.cardId ? " para a carta em conferência" : ""}.
              </p>
              <div className="admin-products">
                {list.data.map((product) => (
                  <article className="admin-product-row" key={product.id}>
                    <div>
                      <h3>{product.card.name}</h3>
                      <p>
                        {product.card.set.name} · {product.card.number}
                      </p>
                      <small>
                        {product.condition.name} · {product.language.name} ·{" "}
                        {product.category.name}
                      </small>
                      <div className="admin-badges">
                        <span>{product.active ? "Ativo" : "Inativo"}</span>
                        {product.featured && (
                          <span>Em destaque · {product.featuredOrder}</span>
                        )}
                      </div>
                    </div>
                    <div className="admin-product-price">
                      <strong>{money(product.price)}</strong>
                      <small>
                        {product.inventory
                          ? `${product.inventory.availableQuantity} disponíveis`
                          : "Estoque não cadastrado"}
                      </small>
                      <button
                        className="outline"
                        disabled={busy}
                        aria-label={`Gerenciar ${product.card.name}`}
                        onClick={() => {
                          setNotice("");
                          void loadProduct(product.id);
                        }}
                      >
                        Gerenciar
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              {!list.data.length && (
                <p>Nenhum produto encontrado para esta consulta.</p>
              )}
              <div className="shipping-pagination">
                <button
                  disabled={busy || page <= 1}
                  onClick={() => setPage((value) => value - 1)}
                >
                  Anterior
                </button>
                <span>
                  Página {page} de {Math.max(1, list.pagination.totalPages)}
                </span>
                <button
                  disabled={busy || page >= list.pagination.totalPages}
                  onClick={() => setPage((value) => value + 1)}
                >
                  Próxima
                </button>
              </div>
            </>
          ) : null}
        </>
      ) : view === "new" || view === "edit" ? (
        <>
          {options && (
            <ProductEditor
              key={view === "new" ? "new" : current!.id}
              product={view === "edit" ? current! : undefined}
              options={options}
              busy={busy}
              isCurrentSession={() => valid()}
              onSave={save}
              onCancel={() => {
                if (!lock.current) {
                  if (view === "edit") setView("detail");
                  else back();
                }
              }}
            />
          )}
        </>
      ) : (
        <>
          <button className="clear" disabled={busy} onClick={back}>
            Voltar aos produtos
          </button>
          {checking && <p role="status">Consultando produto…</p>}
          {!checking && selectedId && (
            <button
              className="outline"
              disabled={busy}
              onClick={() => void loadProduct(selectedId)}
            >
              Atualizar produto
            </button>
          )}
          {current && (
            <>
              <div className="admin-product-heading">
                <h3>{current.card.name}</h3>
                <p>
                  {current.card.set.name} · {current.card.number}
                </p>
                <p>
                  {current.condition.name} · {current.language.name} ·{" "}
                  {current.category.name}
                </p>
                <strong>{money(current.price)}</strong>
                <div className="admin-badges">
                  <span>{current.active ? "Ativo" : "Inativo"}</span>
                  {current.featured && (
                    <span>Em destaque · ordem {current.featuredOrder}</span>
                  )}
                </div>
              </div>
              {current.observation && (
                <p className="admin-observation">{current.observation}</p>
              )}
              <button
                className="outline"
                disabled={busy || stale || checking || !options}
                onClick={() => {
                  setView("edit");
                  setError("");
                  setNotice("");
                }}
              >
                Editar anúncio
              </button>
              {stale && (
                <p className="error">
                  Atualize o produto para revisar o resultado antes de outra
                  alteração.
                </p>
              )}
              <section className="admin-stock" aria-label="Estoque do produto">
                {onOpenHistory && (
                  <button
                    className="outline"
                    disabled={busy || checking || stale}
                    onClick={() => {
                      if (valid() && !lock.current && current)
                        onOpenHistory(current.id);
                    }}
                  >
                    Ver histórico de estoque
                  </button>
                )}
                <h3>Estoque</h3>
                {current.inventory ? (
                  <>
                    <dl className="admin-stock-summary">
                      <div>
                        <dt>Disponíveis</dt>
                        <dd>{current.inventory.availableQuantity}</dd>
                      </div>
                      <div>
                        <dt>Reservadas</dt>
                        <dd>{current.inventory.reservedQuantity}</dd>
                      </div>
                      <div>
                        <dt>Vendidas</dt>
                        <dd>{current.inventory.soldQuantity}</dd>
                      </div>
                    </dl>
                    <p className="muted">
                      Ajuste somente as unidades disponíveis para novas compras.
                      Reservas e vendas são controladas pelos pedidos.
                    </p>
                    <div className="stock-entry-toggle">
                      <button
                        className="outline"
                        disabled={
                          busy || checking || stale || stockReview !== null
                        }
                        onClick={() => setShowEntry((previous) => !previous)}
                      >
                        {showEntry
                          ? "Voltar ao ajuste de estoque"
                          : "Registrar entrada de estoque"}
                      </button>
                    </div>
                    {showEntry ? (
                      <Suspense
                        fallback={
                          <p role="status">Carregando entrada de estoque…</p>
                        }
                      >
                        <StockEntryForm
                          key={`${userId}:${current.id}`}
                          userId={userId}
                          productId={current.id}
                          disabled={
                            busy || checking || stale || stockReview !== null
                          }
                          isCurrentSession={valid}
                          onBusyChange={markBusy}
                          onRecorded={recordedEntry}
                        />
                      </Suspense>
                    ) : (
                      <form onSubmit={reviewStock}>
                        <label>
                          Novo estoque disponível
                          <input
                            inputMode="numeric"
                            value={stock}
                            disabled={
                              busy || stale || checking || stockReview !== null
                            }
                            onChange={(event) => setStock(event.target.value)}
                          />
                        </label>
                        <label>
                          Motivo do ajuste (opcional)
                          <input
                            maxLength={500}
                            value={stockReason}
                            disabled={
                              busy || stale || checking || stockReview !== null
                            }
                            onChange={(event) =>
                              setStockReason(event.target.value)
                            }
                          />
                        </label>
                        <button
                          className="outline"
                          disabled={
                            busy || stale || checking || stockReview !== null
                          }
                        >
                          Revisar estoque
                        </button>
                      </form>
                    )}
                    {stockReview !== null && (
                      <div className="admin-stock-review">
                        <p>
                          Alterar de{" "}
                          <strong>{current.inventory.availableQuantity}</strong>{" "}
                          para <strong>{stockReview}</strong> unidades
                          disponíveis?
                        </p>
                        {stockReason.trim() && (
                          <p>Motivo: {stockReason.trim()}</p>
                        )}
                        <div className="button-row">
                          <button
                            className="primary"
                            disabled={busy || stale}
                            onClick={() => void saveStock()}
                          >
                            {busy ? "Salvando…" : "Confirmar estoque"}
                          </button>
                          <button
                            className="clear"
                            disabled={busy}
                            onClick={() => setStockReview(null)}
                          >
                            Voltar à revisão
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <p>
                    Este produto não tem estoque cadastrado. O ajuste está
                    indisponível para evitar quantidades presumidas.
                  </p>
                )}
              </section>
            </>
          )}
        </>
      )}
    </section>
  );
}
