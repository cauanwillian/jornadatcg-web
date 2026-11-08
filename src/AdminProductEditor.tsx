import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { authorized } from "./session";
import { productDraft, validateProduct } from "./admin-products";
import type {
  AdminProduct,
  ProductDraft,
  ProductInput,
  ProductOptions,
} from "./admin-products";

interface LocalCard {
  id: string;
  name: string;
  number: string;
  set: { name: string };
}
interface CardsPage {
  data: LocalCard[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export function ProductEditor({
  product,
  options,
  busy,
  onSave,
  onCancel,
  isCurrentSession,
}: {
  product?: AdminProduct;
  options: ProductOptions;
  busy: boolean;
  onSave: (input: ProductInput) => Promise<boolean>;
  onCancel: () => void;
  isCurrentSession: () => boolean;
}) {
  const [draft, setDraft] = useState(() => productDraft(product));
  const [errors, setErrors] = useState<
    Partial<Record<keyof ProductDraft, string>>
  >({});
  const [cards, setCards] = useState<CardsPage | null>(null);
  const [selectedCard, setSelectedCard] = useState<LocalCard | null>(null);
  const [filter, setFilter] = useState("");
  const [appliedFilter, setAppliedFilter] = useState("");
  const [searchError, setSearchError] = useState("");
  const [loading, setLoading] = useState(!product);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const alive = useRef(true);
  const mutation = useRef(false);
  const revision = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const startRead = useRef<() => Promise<void>>(async () => {});
  const latest = useRef({ busy, isCurrentSession, onSave, onCancel });
  useLayoutEffect(() => {
    latest.current = { busy, isCurrentSession, onSave, onCancel };
  }, [busy, isCurrentSession, onSave, onCancel]);
  const prefix = useId();
  const blocked = busy || saving;
  const creating = !product;

  function current() {
    return alive.current && latest.current.isCurrentSession();
  }
  function change<K extends keyof ProductDraft>(
    field: K,
    value: ProductDraft[K],
  ) {
    if (!current() || blocked || mutation.current) return;
    setDraft((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => ({ ...previous, [field]: undefined }));
    setSaveError("");
  }
  async function loadCards(page: number, name: string) {
    if (!current() || latest.current.busy || mutation.current || product)
      return;
    controller.current?.abort();
    const read = new AbortController();
    controller.current = read;
    const started = ++revision.current;
    setLoading(true);
    setSearchError("");
    const query = new URLSearchParams({ page: String(page), limit: "12" });
    if (name) query.set("name", name);
    try {
      const result = await authorized<CardsPage>(`/cards?${query}`, {
        signal: read.signal,
      });
      if (!current() || read.signal.aborted || revision.current !== started)
        return;
      setCards(result);
      setAppliedFilter(name);
    } catch (error) {
      if (!current() || read.signal.aborted || revision.current !== started)
        return;
      setSearchError(
        error instanceof Error
          ? error.message
          : "Não foi possível consultar as cartas cadastradas.",
      );
    } finally {
      if (current() && !read.signal.aborted && revision.current === started)
        setLoading(false);
    }
  }

  useLayoutEffect(() => {
    startRead.current = async () => {
      if (!product) await loadCards(1, "");
    };
  });

  function stop() {
    alive.current = false;
    revision.current++;
    controller.current?.abort();
  }

  useEffect(() => {
    alive.current = true;
    let active = true;
    void Promise.resolve().then(() => {
      if (active) return startRead.current();
    });
    return () => {
      active = false;
      stop();
    };
  }, []);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (blocked || loading || !current()) return;
    const name = filter.trim();
    if (filter.length > 200) {
      setSearchError("Informe um nome com até 200 caracteres.");
      return;
    }
    void loadCards(1, name);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (blocked || mutation.current || !current() || (creating && loading))
      return;
    const validated = validateProduct(draft, creating);
    const nextErrors = { ...validated.errors };
    const references = [
      ["categoryId", options.categories, product?.category.id],
      ["conditionId", options.conditions, product?.condition.id],
      ["languageId", options.languages, product?.language.id],
    ] as const;
    for (const [field, choices, original] of references) {
      if (
        draft[field] &&
        !choices.some((option) => option.id === draft[field]) &&
        draft[field] !== original
      )
        nextErrors[field] = "Escolha uma opção disponível.";
    }
    setErrors(nextErrors);
    if (!validated.input || Object.values(nextErrors).some(Boolean)) return;
    mutation.current = true;
    setSaving(true);
    setSaveError("");
    revision.current++;
    controller.current?.abort();
    setLoading(false);
    try {
      if (!current()) return;
      await latest.current.onSave(validated.input);
    } catch {
      if (current())
        setSaveError(
          "Não foi possível salvar o produto. Confira o resultado antes de tentar novamente.",
        );
    } finally {
      mutation.current = false;
      if (current()) setSaving(false);
    }
  }

  function error(field: keyof ProductDraft) {
    return errors[field] ? (
      <small className="field-error" id={`${prefix}-${field}-error`}>
        {errors[field]}
      </small>
    ) : null;
  }
  function validity(field: keyof ProductDraft) {
    return {
      "aria-invalid": Boolean(errors[field]),
      "aria-describedby": errors[field]
        ? `${prefix}-${field}-error`
        : undefined,
    };
  }
  function reference(
    field: "categoryId" | "conditionId" | "languageId",
    label: string,
  ) {
    const choices =
      field === "categoryId"
        ? options.categories
        : field === "conditionId"
          ? options.conditions
          : options.languages;
    const original =
      field === "categoryId"
        ? product?.category
        : field === "conditionId"
          ? product?.condition
          : product?.language;
    const originalMissing =
      original && !choices.some((choice) => choice.id === original.id);
    return (
      <div>
        <label>
          {label}
          <select
            value={draft[field]}
            onChange={(event) => change(field, event.target.value)}
            {...validity(field)}
          >
            <option value="">Selecione</option>
            {originalMissing && (
              <option value={original.id}>
                {original.name} (
                {original.active ? "referência atual indisponível" : "inativo"})
              </option>
            )}
            {choices.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.name}
              </option>
            ))}
          </select>
        </label>
        {error(field)}
      </div>
    );
  }

  return (
    <section className="admin-product-editor">
      <h3>{creating ? "Novo produto" : "Editar produto"}</h3>
      {creating ? (
        <section
          className="admin-card-picker"
          aria-label="Escolha da carta cadastrada"
        >
          <p className="hint">Selecione uma carta já cadastrada no sistema.</p>
          <form onSubmit={search} noValidate>
            <fieldset disabled={blocked} className="shipping-fieldset">
              <label htmlFor={`${prefix}-search`}>Buscar carta pelo nome</label>
              <input
                id={`${prefix}-search`}
                value={filter}
                maxLength={200}
                onChange={(event) => setFilter(event.target.value)}
                aria-invalid={Boolean(searchError)}
                aria-describedby={
                  searchError ? `${prefix}-search-error` : undefined
                }
              />
              <button type="submit" className="outline" disabled={loading}>
                Buscar cartas cadastradas
              </button>
            </fieldset>
          </form>
          {searchError && (
            <p className="error" role="alert" id={`${prefix}-search-error`}>
              {searchError}
            </p>
          )}
          {loading && <p role="status">Consultando cartas cadastradas…</p>}
          {cards && (
            <fieldset
              className="admin-card-results shipping-fieldset"
              disabled={blocked || loading}
              aria-describedby={
                errors.cardId ? `${prefix}-cardId-error` : undefined
              }
            >
              <legend>Escolha uma carta</legend>
              {cards.data.length === 0 && (
                <p>Nenhuma carta cadastrada encontrada.</p>
              )}
              {cards.data.map((card) => (
                <label
                  key={card.id}
                  className="admin-card-option checkbox-label"
                >
                  <input
                    type="radio"
                    name={`${prefix}-card`}
                    value={card.id}
                    checked={draft.cardId === card.id}
                    aria-invalid={Boolean(errors.cardId)}
                    onChange={() => {
                      change("cardId", card.id);
                      setSelectedCard(card);
                    }}
                  />
                  <span>
                    <strong>{card.name}</strong>
                    <small>
                      {" "}
                      Nº {card.number} · {card.set.name}
                    </small>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          {error("cardId")}
          {selectedCard && (
            <p className="hint">
              Carta selecionada: <strong>{selectedCard.name}</strong> · Nº{" "}
              {selectedCard.number} · {selectedCard.set.name}
            </p>
          )}
          {cards && cards.pagination.totalPages > 1 && (
            <nav
              className="shipping-pagination"
              aria-label="Páginas das cartas cadastradas"
            >
              <button
                type="button"
                disabled={blocked || loading || cards.pagination.page <= 1}
                onClick={() =>
                  void loadCards(cards.pagination.page - 1, appliedFilter)
                }
              >
                Anterior
              </button>
              <span>
                Página {cards.pagination.page} de {cards.pagination.totalPages}
              </span>
              <button
                type="button"
                disabled={
                  blocked ||
                  loading ||
                  cards.pagination.page >= cards.pagination.totalPages
                }
                onClick={() =>
                  void loadCards(cards.pagination.page + 1, appliedFilter)
                }
              >
                Próxima
              </button>
            </nav>
          )}
        </section>
      ) : (
        <p className="admin-card-summary">
          <strong>{product.card.name}</strong> · Nº {product.card.number} ·{" "}
          {product.card.set.name}
          <br />
          <small>A carta vinculada ao produto não pode ser alterada.</small>
        </p>
      )}
      <form className="admin-product-form" noValidate onSubmit={save}>
        <fieldset className="shipping-fieldset" disabled={blocked}>
          <div className="form-grid">
            {reference("categoryId", "Categoria")}
            {reference("conditionId", "Condição")}
            {reference("languageId", "Idioma")}
            <div>
              <label>
                Preço (R$)
                <input
                  value={draft.price}
                  inputMode="decimal"
                  autoComplete="off"
                  onChange={(event) => change("price", event.target.value)}
                  {...validity("price")}
                />
              </label>
              {error("price")}
            </div>
            {creating && (
              <div>
                <label>
                  Estoque inicial
                  <input
                    value={draft.availableQuantity}
                    inputMode="numeric"
                    autoComplete="off"
                    onChange={(event) =>
                      change("availableQuantity", event.target.value)
                    }
                    {...validity("availableQuantity")}
                  />
                </label>
                {error("availableQuantity")}
              </div>
            )}
            <div>
              <label>
                Ordem do destaque
                <input
                  value={draft.featuredOrder}
                  inputMode="numeric"
                  autoComplete="off"
                  onChange={(event) =>
                    change("featuredOrder", event.target.value)
                  }
                  {...validity("featuredOrder")}
                />
              </label>
              {error("featuredOrder")}
            </div>
          </div>
          {!creating && (
            <p className="hint">
              Estoque disponível:{" "}
              {product.inventory
                ? product.inventory.availableQuantity
                : "Não cadastrado"}
              . Ajuste o estoque separadamente na página do produto.
            </p>
          )}
          <div>
            <label>
              Observação (opcional)
              <textarea
                value={draft.observation}
                maxLength={2000}
                onChange={(event) => change("observation", event.target.value)}
                {...validity("observation")}
              />
            </label>
            {error("observation")}
          </div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={draft.active}
              onChange={(event) => change("active", event.target.checked)}
            />
            Produto ativo
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={draft.featured}
              onChange={(event) => change("featured", event.target.checked)}
            />
            Exibir nos destaques
          </label>
          {saveError && (
            <p className="error" role="alert">
              {saveError}
            </p>
          )}
          {Object.values(errors).some(Boolean) && (
            <p className="error" role="alert">
              Confira os campos indicados antes de salvar.
            </p>
          )}
          <div className="button-row">
            <button
              className="outline"
              type="button"
              onClick={() => {
                if (!blocked && !mutation.current && current())
                  latest.current.onCancel();
              }}
            >
              Cancelar edição
            </button>
            <button
              className="primary"
              type="submit"
              disabled={creating && loading}
            >
              {saving
                ? "Salvando…"
                : creating
                  ? "Cadastrar produto"
                  : "Salvar alterações"}
            </button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}
