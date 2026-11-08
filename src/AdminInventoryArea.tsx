import { useId, useRef } from "react";
import type {
  InventoryFilterDraft,
  InventoryRow,
  InventorySummary,
} from "./admin-inventory";
import { useAdminInventory } from "./useAdminInventory";
import type { InventoryCallbacks } from "./useAdminInventory";

function Summary({ value }: { value: InventorySummary }) {
  return (
    <dl className="inventory-summary" aria-label="Resumo do estoque filtrado">
      {(
        [
          ["Produtos encontrados", value.productCount],
          ["Com disponibilidade", value.availableCount],
          ["Esgotados", value.outOfStockCount],
          ["Estoque baixo", value.lowStockCount],
          ["Com reservas", value.reservedCount],
          ["Sem cadastro", value.missingInventoryCount],
        ] as const
      ).map(([label, count]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{count}</dd>
        </div>
      ))}
    </dl>
  );
}

function ProductRow({
  product,
  threshold,
  onOpen,
  onHistory,
}: {
  product: InventoryRow;
  threshold: number;
  onOpen?: () => void;
  onHistory?: () => void;
}) {
  const stock = product.inventory;
  const situation = !stock
    ? "Sem estoque cadastrado"
    : stock.availableQuantity === 0
      ? "Esgotado"
      : stock.availableQuantity <= threshold
        ? "Estoque baixo"
        : "Disponível";
  return (
    <li className="inventory-row">
      <article aria-label={`Estoque de ${product.card.name}`}>
        <div className="inventory-product-heading">
          <div>
            <h4>{product.card.name}</h4>
            <p>
              {product.card.set.name} · {product.card.number}
            </p>
            <small>
              {product.condition.name} · {product.language.name} ·{" "}
              {product.category.name}
            </small>
            <div className="inventory-badges">
              <span>
                {product.active ? "Anúncio ativo" : "Anúncio inativo"}
              </span>
              <span>{situation}</span>
              {stock && stock.reservedQuantity > 0 && <span>Com reservas</span>}
            </div>
          </div>
          <div className="inventory-actions">
            {onOpen && (
              <button
                className="outline"
                aria-label={`Gerenciar produto ${product.card.name}`}
                onClick={onOpen}
              >
                Gerenciar produto
              </button>
            )}
            {onHistory && (
              <button
                className="outline"
                aria-label={`Ver histórico de ${product.card.name}`}
                onClick={onHistory}
              >
                Ver histórico
              </button>
            )}
          </div>
        </div>
        {stock ? (
          <>
            <dl className="inventory-quantities">
              <div>
                <dt>Disponíveis</dt>
                <dd>{stock.availableQuantity}</dd>
              </div>
              <div>
                <dt>Reservadas</dt>
                <dd>{stock.reservedQuantity}</dd>
              </div>
              <div>
                <dt>Vendidas</dt>
                <dd>{stock.soldQuantity}</dd>
              </div>
            </dl>
            <p className="inventory-updated">
              Estoque atualizado em{" "}
              {new Date(stock.updatedAt).toLocaleString("pt-BR")}
            </p>
          </>
        ) : (
          <p className="inventory-help">
            Quantidades não informadas. Consulte o cadastro do produto.
          </p>
        )}
      </article>
    </li>
  );
}

export function AdminInventoryArea(props: InventoryCallbacks) {
  const state = useAdminInventory(props);
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  if (!props.isCurrentSession()) return null;
  if (state.denied)
    return (
      <p className="error" role="alert">
        Acesso restrito a administradores. Entre novamente com uma conta
        autorizada.
      </p>
    );
  const issue = (key: keyof InventoryFilterDraft) =>
    state.validation[key] && (
      <small className="field-error" id={`${id}-${key}-error`}>
        {state.validation[key]}
      </small>
    );
  const described = (key: keyof InventoryFilterDraft) =>
    state.validation[key] ? `${id}-${key}-error` : undefined;
  const outsidePage =
    state.list && state.page > Math.max(1, Math.ceil(state.list.total / 20));
  return (
    <section className="admin-inventory" aria-label="Visão de estoque">
      <p className="inventory-help">
        Consulte as unidades livres para venda e acompanhe reservas e saldos
        registrados nos produtos.
      </p>
      <div className="inventory-toolbar">
        <h3>Consultar estoque</h3>
        <button
          className="outline"
          disabled={state.loading}
          onClick={state.refresh}
        >
          Atualizar estoque
        </button>
      </div>
      <form
        ref={form}
        className="inventory-filters"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const invalid = state.apply();
          if (invalid)
            form.current
              ?.querySelector<HTMLInputElement | HTMLSelectElement>(
                `[name="${invalid}"]`,
              )
              ?.focus();
        }}
      >
        <div>
          <label htmlFor={`${id}-name`}>Nome da carta</label>
          <input
            id={`${id}-name`}
            name="name"
            maxLength={200}
            value={state.draft.name}
            disabled={state.loading}
            aria-invalid={Boolean(state.validation.name)}
            aria-describedby={described("name")}
            onChange={(event) => state.changeDraft("name", event.target.value)}
          />
          {issue("name")}
        </div>
        <div>
          <label htmlFor={`${id}-active`}>Status do anúncio</label>
          <select
            id={`${id}-active`}
            name="active"
            value={state.draft.active}
            disabled={state.loading}
            aria-invalid={Boolean(state.validation.active)}
            aria-describedby={described("active")}
            onChange={(event) =>
              state.changeDraft("active", event.target.value)
            }
          >
            <option value="">Todos</option>
            <option value="true">Ativos</option>
            <option value="false">Inativos</option>
          </select>
          {issue("active")}
        </div>
        <div>
          <label htmlFor={`${id}-stock`}>Situação do estoque</label>
          <select
            id={`${id}-stock`}
            name="stock"
            value={state.draft.stock}
            disabled={state.loading}
            aria-invalid={Boolean(state.validation.stock)}
            aria-describedby={described("stock")}
            onChange={(event) => state.changeDraft("stock", event.target.value)}
          >
            <option value="">Todas</option>
            <option value="available">Disponível</option>
            <option value="out">Esgotado</option>
            <option value="low">Estoque baixo</option>
            <option value="reserved">Com reservas</option>
            <option value="missing">Sem cadastro</option>
          </select>
          {issue("stock")}
        </div>
        <div>
          <label htmlFor={`${id}-lowStockThreshold`}>
            Limite de estoque baixo
          </label>
          <input
            id={`${id}-lowStockThreshold`}
            name="lowStockThreshold"
            inputMode="numeric"
            maxLength={10}
            value={state.draft.lowStockThreshold}
            disabled={state.loading}
            aria-invalid={Boolean(state.validation.lowStockThreshold)}
            aria-describedby={described("lowStockThreshold")}
            onChange={(event) =>
              state.changeDraft("lowStockThreshold", event.target.value)
            }
          />
          {issue("lowStockThreshold")}
        </div>
        <div className="button-row">
          <button className="primary" disabled={state.loading}>
            Aplicar filtros
          </button>
          <button
            type="button"
            className="outline"
            disabled={state.loading}
            onClick={state.clear}
          >
            Limpar filtros
          </button>
        </div>
      </form>
      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {state.loading && (
        <p className="inventory-loading" role="status" aria-busy="true">
          Carregando estoque e resumo…
        </p>
      )}
      {state.list && (
        <>
          <Summary value={state.list.summary} />
          <p className="inventory-help">
            O resumo abrange todos os produtos dos filtros aplicados, incluindo
            outras páginas. Estoque baixo: de 1 a {state.list.lowStockThreshold}{" "}
            unidades disponíveis. Produtos com reservas também podem estar
            disponíveis ou esgotados. Sem cadastro não significa estoque zero.
          </p>
          <p className="inventory-help">
            Vendidas mostra o total acumulado registrado em cada produto.
          </p>
          {outsidePage && (
            <div className="inventory-empty">
              <p role="status">
                A lista mudou e esta página ficou vazia. Consulte a primeira
                página para ver os resultados atuais.
              </p>
              <button
                className="outline"
                disabled={state.loading}
                onClick={() => state.changePage(1)}
              >
                Voltar à primeira página
              </button>
            </div>
          )}
          {!outsidePage && !state.list.items.length && (
            <p className="inventory-empty">
              Nenhum produto encontrado para os filtros aplicados.
            </p>
          )}
          <ul className="inventory-products">
            {state.list.items.map((product) => (
              <ProductRow
                key={product.id}
                product={product}
                threshold={state.list!.lowStockThreshold}
                onHistory={
                  props.onOpenHistory
                    ? () => state.openHistory(product.id)
                    : undefined
                }
                onOpen={
                  props.onOpenProduct
                    ? () => state.openProduct(product.id)
                    : undefined
                }
              />
            ))}
          </ul>
          {!outsidePage && state.list.total > 20 && (
            <nav
              className="inventory-pagination"
              aria-label="Páginas de estoque"
            >
              <button
                className="outline"
                disabled={state.loading || state.page <= 1}
                onClick={() => state.changePage(state.page - 1)}
              >
                Anterior
              </button>
              <span>
                Página {state.page} de {Math.ceil(state.list.total / 20)}
              </span>
              <button
                className="outline"
                disabled={
                  state.loading ||
                  state.page >=
                    Math.min(1_000_000, Math.ceil(state.list.total / 20))
                }
                onClick={() => state.changePage(state.page + 1)}
              >
                Próxima
              </button>
            </nav>
          )}
        </>
      )}
      {state.error && (
        <button
          className="outline"
          disabled={state.loading}
          onClick={state.refresh}
        >
          Tentar novamente
        </button>
      )}
    </section>
  );
}
