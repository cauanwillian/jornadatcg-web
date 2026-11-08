import { useEffect, useRef } from "react";
import { money } from "./api";
import type { Order } from "./purchase";
import { useMyOrders } from "./useMyOrders";

const labels: Record<Order["status"], string> = {
  PENDING_PAYMENT: "Aguardando pagamento",
  PAID: "Pagamento confirmado",
  PREPARING: "Em preparação",
  READY_TO_SHIP: "Pronto para envio",
  SHIPPED: "Enviado",
  DELIVERED: "Entregue",
  CANCELLED: "Cancelado",
};
const currentSession = () => true;
const noop = () => {};
const dateTime = (value: string) => new Date(value).toLocaleString("pt-BR");

export function MyOrders({
  onOpen,
  isCurrentSession = currentSession,
  onBusyChange = noop,
  onChanged,
}: {
  onOpen: (order: Order) => void;
  isCurrentSession?: () => boolean;
  onBusyChange?: (busy: boolean) => void;
  onChanged?: () => void;
}) {
  const state = useMyOrders({
    onOpen,
    isCurrentSession,
    onBusyChange,
    onChanged,
  });
  const heading = useRef<HTMLHeadingElement>(null);
  const selectedId = state.selected?.id;
  useEffect(() => {
    if (selectedId) heading.current?.focus();
  }, [selectedId]);
  if (!isCurrentSession()) return null;
  if (state.denied)
    return (
      <p className="error" role="alert">
        Não foi possível acessar os pedidos desta conta. Entre novamente.
      </p>
    );
  const order = state.selected;
  const disabled = state.loading || state.checking || state.busy;
  return (
    <section
      className="my-orders customer-orders"
      aria-label="Lista de pedidos"
    >
      <p className="customer-orders-help">
        Acompanhe seus pedidos e retome o pagamento das cartas. Pedidos que
        aguardam pagamento podem ser verificados para cancelamento.
      </p>
      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {state.notice && (
        <p className="auth-success" role="status">
          {state.notice}
        </p>
      )}
      {order ? (
        <section
          className="order-cancel-review"
          aria-label="Revisão do cancelamento"
        >
          <h3 ref={heading} tabIndex={-1}>
            Cancelamento do pedido #{order.orderNumber}
          </h3>
          <p className="order-status">{labels[order.status]}</p>
          <ul className="order-cancel-items">
            {order.items.map((item) => (
              <li key={item.id}>
                <span>
                  <strong>
                    {item.quantity}× {item.cardName}
                  </strong>
                  <small>
                    {item.setName} · {item.cardNumber}
                  </small>
                  <small>
                    {item.conditionName} · {item.languageName}
                  </small>
                </span>
                <strong>{money(item.totalPrice)}</strong>
              </li>
            ))}
          </ul>
          <div className="order-cancel-total">
            <span>Total das cartas</span>
            <strong>{money(order.total)}</strong>
          </div>
          {state.checking && (
            <p className="customer-orders-loading" role="status">
              Conferindo pedido e pagamentos…
            </p>
          )}
          {!state.checking &&
            state.review &&
            !state.review.canCancel &&
            order.status !== "CANCELLED" && (
              <p className="shipping-note">
                {order.status === "PENDING_PAYMENT"
                  ? "O pedido possui um pagamento em processamento, confirmado ou reembolsado e não pode ser cancelado por esta opção."
                  : "Este pedido mudou de situação e não pode ser cancelado por esta opção."}
              </p>
            )}
          {!state.checking && state.review?.canCancel && (
            <p className="shipping-note">
              Ao confirmar, o pedido será cancelado e a reserva das cartas será
              liberada. Para comprar novamente, adicione os itens ao carrinho.
            </p>
          )}
          {state.needsRefresh && (
            <p className="order-cancel-recovery">
              Confira a situação atual deste mesmo pedido antes de tentar outra
              ação. Atualizar faz somente uma consulta; não repete o
              cancelamento.
            </p>
          )}
          <div className="order-cancel-actions button-row">
            {state.review?.canCancel && !state.needsRefresh && (
              <button
                className="primary"
                disabled={disabled}
                onClick={() => void state.confirm()}
              >
                {state.busy ? "Cancelando pedido…" : "Confirmar cancelamento"}
              </button>
            )}
            {state.needsRefresh && (
              <button
                className="outline"
                disabled={disabled}
                onClick={state.recheck}
              >
                Atualizar situação do pedido
              </button>
            )}
            <button
              className="outline"
              disabled={state.busy}
              onClick={state.back}
            >
              Voltar aos pedidos
            </button>
          </div>
        </section>
      ) : (
        <>
          <div className="customer-orders-toolbar">
            <h3>Meus pedidos</h3>
            <button
              className="outline"
              disabled={disabled}
              onClick={state.refresh}
            >
              Atualizar pedidos
            </button>
          </div>
          {state.orders.map((row) => (
            <article className="customer-order-card" key={row.id}>
              <button
                className="order-row"
                disabled={disabled}
                onClick={() => state.open(row)}
              >
                <span>
                  <strong>Pedido #{row.orderNumber}</strong>
                  <small>{dateTime(row.createdAt)}</small>
                  <span>{labels[row.status]}</span>
                </span>
                <strong>{money(row.total)}</strong>
              </button>
              {row.status === "PENDING_PAYMENT" && (
                <button
                  className="outline customer-order-cancel"
                  disabled={disabled}
                  onClick={() => state.inspect(row)}
                >
                  Verificar cancelamento do pedido #{row.orderNumber}
                </button>
              )}
            </article>
          ))}
          {!state.loading && !state.error && !state.orders.length && (
            <p className="customer-orders-empty">Você ainda não tem pedidos.</p>
          )}
          {state.loading && (
            <p className="customer-orders-loading" role="status">
              Carregando pedidos…
            </p>
          )}
          {state.error && (
            <button
              className="checkout-back"
              disabled={disabled}
              onClick={state.retry}
            >
              Tentar novamente
            </button>
          )}
          {!state.error && state.hasMore && (
            <button
              className="checkout-back"
              disabled={disabled}
              onClick={state.more}
            >
              Carregar mais pedidos
            </button>
          )}
        </>
      )}
    </section>
  );
}
