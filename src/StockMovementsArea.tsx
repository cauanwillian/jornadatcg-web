import { useId, useRef } from "react";
import { movementLabels } from "./stock-movements";
import type { MovementFilterDraft, StockMovement } from "./stock-movements";
import { useStockMovements } from "./useStockMovements";
import type { StockMovementsProps } from "./useStockMovements";

const signed = (value: number) =>
  value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : "0";
function MovementEntry({ value }: { value: StockMovement }) {
  const manual =
    value.type === "INITIAL_STOCK" ||
    value.type === "MANUAL_ADJUSTMENT" ||
    value.type === "STOCK_RECEIPT";
  return (
    <li className="history-entry">
      <article
        aria-label={`${movementLabels[value.type]} de ${value.product.cardName}`}
      >
        <div className="history-entry-heading">
          <div>
            <h4>{value.product.cardName}</h4>
            <p>
              {value.product.setName} · {value.product.cardNumber}
            </p>
            <small>
              {value.product.conditionName} · {value.product.languageName} ·{" "}
              {value.product.categoryName}
            </small>
          </div>
          <p>
            <strong>{movementLabels[value.type]}</strong>
            <br />
            <time dateTime={value.createdAt}>
              {new Date(value.createdAt).toLocaleString("pt-BR")}
            </time>
          </p>
        </div>
        <p className="history-origin">
          {manual
            ? value.actor
              ? `Responsável: ${value.actor.name}`
              : "Responsável não informado"
            : value.type === "OPENING_BALANCE"
              ? "Abertura na implantação"
              : "Origem: sistema / pedido"}
          {value.order ? ` · Pedido #${value.order.orderNumber}` : ""}
        </p>
        {value.type === "OPENING_BALANCE" && (
          <p className="history-opening">
            Saldo capturado na abertura do histórico. Operações anteriores a
            esta abertura não foram reconstruídas.
          </p>
        )}
        {value.reason && (
          <p className="history-reason">
            <strong>Motivo:</strong> {value.reason}
          </p>
        )}
        <div className="history-balances-wrap">
          <table className="history-balances">
            <caption>Saldos da movimentação</caption>
            <thead>
              <tr>
                <th scope="col">Unidades</th>
                <th scope="col">Antes</th>
                <th scope="col">Variação</th>
                <th scope="col">Depois</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ["Disponíveis", "availableQuantity"],
                  ["Reservadas", "reservedQuantity"],
                  ["Vendidas", "soldQuantity"],
                ] as const
              ).map(([label, key]) => (
                <tr key={key}>
                  <th scope="row">{label}</th>
                  <td>{value.before[key]}</td>
                  <td>{signed(value.change[key])}</td>
                  <td>{value.after[key]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    </li>
  );
}
export function StockMovementsArea(props: StockMovementsProps) {
  const state = useStockMovements(props),
    id = useId(),
    form = useRef<HTMLFormElement>(null);
  if (!props.isCurrentSession()) return null;
  if (state.denied)
    return (
      <p className="error" role="alert">
        Acesso restrito a administradores. Entre novamente com uma conta
        autorizada.
      </p>
    );
  const outside =
    state.list && state.page > Math.max(1, Math.ceil(state.list.total / 20));
  const issue = (key: keyof MovementFilterDraft) =>
    state.validation[key] && (
      <small className="field-error" id={`${id}-${key}-error`}>
        {state.validation[key]}
      </small>
    );
  const described = (key: keyof MovementFilterDraft) =>
    state.validation[key] ? `${id}-${key}-error` : undefined;
  return (
    <section className="stock-history" aria-label="Histórico de estoque">
      <p className="history-help">
        Acompanhe ajustes, reservas, liberações e vendas com os saldos
        registrados em cada operação.
      </p>
      <div className="history-toolbar">
        <h3>Consultar movimentações</h3>
        <button
          className="outline"
          disabled={state.loading}
          onClick={state.refresh}
        >
          Atualizar histórico
        </button>
      </div>
      {state.filters.productId && (
        <aside className="history-scope">
          <p>
            Produto selecionado no estoque
            {state.list?.items[0]
              ? `: ${state.list.items[0].product.cardName}`
              : ""}
            .
          </p>
          <button
            className="outline"
            disabled={state.loading}
            onClick={state.general}
          >
            Ver histórico geral
          </button>
        </aside>
      )}
      <form
        className="history-filters"
        ref={form}
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
          <label htmlFor={`${id}-type`}>Tipo de movimentação</label>
          <select
            id={`${id}-type`}
            name="type"
            value={state.draft.type}
            disabled={state.loading}
            aria-invalid={Boolean(state.validation.type)}
            aria-describedby={described("type")}
            onChange={(event) => state.changeDraft("type", event.target.value)}
          >
            <option value="">Todos</option>
            {Object.entries(movementLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {issue("type")}
        </div>
        <div>
          <label htmlFor={`${id}-from`}>De</label>
          <input
            id={`${id}-from`}
            type="date"
            name="from"
            value={state.draft.from}
            disabled={state.loading}
            aria-invalid={Boolean(state.validation.from)}
            aria-describedby={described("from")}
            onChange={(event) => state.changeDraft("from", event.target.value)}
          />
          {issue("from")}
        </div>
        <div>
          <label htmlFor={`${id}-to`}>Até</label>
          <input
            id={`${id}-to`}
            type="date"
            name="to"
            value={state.draft.to}
            disabled={state.loading}
            aria-invalid={Boolean(state.validation.to)}
            aria-describedby={described("to")}
            onChange={(event) => state.changeDraft("to", event.target.value)}
          />
          {issue("to")}
        </div>
        <p className="history-help">
          Os dias informados estão incluídos no período e usam o horário deste
          dispositivo.
        </p>
        <div className="button-row">
          <button className="primary" disabled={state.loading}>
            Aplicar filtros
          </button>
          <button
            className="outline"
            type="button"
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
        <p className="history-loading" role="status" aria-busy="true">
          Carregando movimentações…
        </p>
      )}
      {state.list && (
        <>
          <p className="history-help">
            {state.list.total}{" "}
            {state.list.total === 1
              ? "movimentação encontrada"
              : "movimentações encontradas"}
            . Os registros mais recentes aparecem primeiro.
          </p>
          {outside ? (
            <div className="history-empty" role="status">
              <p>
                A lista mudou. Volte à primeira página para consultar os
                registros disponíveis.
              </p>
              <button className="outline" onClick={() => state.changePage(1)}>
                Voltar à primeira página
              </button>
            </div>
          ) : (
            !state.list.items.length && (
              <p className="history-empty">
                Nenhuma movimentação registrada para os filtros aplicados.
              </p>
            )
          )}
          <ol className="history-list">
            {state.list.items.map((value) => (
              <MovementEntry key={value.id} value={value} />
            ))}
          </ol>
          {!outside && state.list.total > 20 && (
            <nav
              className="history-pagination"
              aria-label="Páginas de movimentações"
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
