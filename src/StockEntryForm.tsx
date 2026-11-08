import { useEffect, useId, useRef } from "react";
import { useStockEntry } from "./useStockEntry";
import type { StockEntryProps } from "./useStockEntry";

export function StockEntryForm(props: StockEntryProps) {
  const state = useStockEntry(props);
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (state.review) heading.current?.focus();
  }, [state.review]);
  if (!props.isCurrentSession() || !state.matchesOwner) return null;
  if (state.denied)
    return (
      <section className="stock-entry" aria-label="Entrada de estoque">
        <p className="error" role="alert">
          Acesso restrito a administradores. Entre novamente com uma conta
          autorizada.
        </p>
      </section>
    );
  const issue = (key: "quantity" | "reason") =>
    state.validation[key] && (
      <small id={`${id}-${key}-error`} className="field-error">
        {state.validation[key]}
      </small>
    );
  return (
    <section className="stock-entry" aria-label="Entrada de estoque">
      <h4>Registrar entrada</h4>
      <p className="stock-entry-help">
        Adicione unidades ao saldo disponível. Reservas e vendas serão
        preservadas.
      </p>
      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {state.success ? (
        <p className="stock-entry-status" role="status">
          Entrada registrada. O cadastro será atualizado.
        </p>
      ) : state.pending ? (
        <div
          className="stock-entry-pending"
          aria-label="Entrada pendente de confirmação"
        >
          <p>
            {state.receipt
              ? "Entrada confirmada no estoque."
              : "A entrada pode ter sido registrada. Confira a mesma tentativa antes de continuar."}
          </p>
          <p>
            <strong>Quantidade:</strong> {state.pending.quantity}{" "}
            {state.pending.quantity === 1 ? "unidade" : "unidades"} disponíveis.
          </p>
          <p>
            <strong>Motivo:</strong> {state.pending.reason}
          </p>
          <div className="button-row">
            <button
              className="outline"
              disabled={state.disabled}
              onClick={state.verify}
            >
              Verificar entrada
            </button>
            {!state.receipt && (
              <button
                className="outline"
                disabled={state.disabled || state.storageBlocked}
                onClick={state.retry}
              >
                Reenviar a mesma entrada
              </button>
            )}
          </div>
          <p className="stock-entry-help">
            A verificação consulta o registro. O reenvio usa os mesmos dados da
            tentativa salva.
          </p>
        </div>
      ) : state.review ? (
        <div className="stock-entry-review" aria-label="Revisão da entrada">
          <h5 ref={heading} tabIndex={-1}>
            Conferir entrada
          </h5>
          <p>
            Somar <strong>{state.review.quantity}</strong>{" "}
            {state.review.quantity === 1 ? "unidade" : "unidades"} ao saldo
            disponível deste produto?
          </p>
          <p>
            <strong>Motivo:</strong> {state.review.reason}
          </p>
          <div className="button-row">
            <button
              className="primary"
              disabled={state.disabled || state.storageBlocked}
              onClick={state.confirm}
            >
              Confirmar entrada
            </button>
            <button
              className="outline"
              disabled={state.disabled}
              onClick={state.edit}
            >
              Editar entrada
            </button>
          </div>
        </div>
      ) : (
        <form
          ref={form}
          className="stock-entry-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            const invalid = state.prepare();
            if (invalid)
              form.current
                ?.querySelector<HTMLInputElement>(`[name="${invalid}"]`)
                ?.focus();
          }}
        >
          <div>
            <label htmlFor={`${id}-quantity`}>Quantidade de entrada</label>
            <input
              id={`${id}-quantity`}
              name="quantity"
              inputMode="numeric"
              maxLength={10}
              value={state.draft.quantity}
              disabled={state.disabled || state.storageBlocked}
              aria-invalid={Boolean(state.validation.quantity)}
              aria-describedby={
                state.validation.quantity ? `${id}-quantity-error` : undefined
              }
              onChange={(event) => state.change("quantity", event.target.value)}
            />
            {issue("quantity")}
          </div>
          <div>
            <label htmlFor={`${id}-reason`}>Motivo da entrada</label>
            <input
              id={`${id}-reason`}
              name="reason"
              maxLength={500}
              value={state.draft.reason}
              disabled={state.disabled || state.storageBlocked}
              aria-invalid={Boolean(state.validation.reason)}
              aria-describedby={
                state.validation.reason ? `${id}-reason-error` : undefined
              }
              onChange={(event) => state.change("reason", event.target.value)}
            />
            {issue("reason")}
          </div>
          <button
            className="outline"
            disabled={state.disabled || state.storageBlocked}
          >
            Revisar entrada
          </button>
        </form>
      )}
      {(state.busy || state.checking) && (
        <p className="stock-entry-status" role="status" aria-busy="true">
          {state.busy ? "Registrando entrada…" : "Verificando entrada…"}
        </p>
      )}
    </section>
  );
}
