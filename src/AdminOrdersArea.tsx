import { useEffect, useId, useRef } from "react";
import { salesMoney } from "./admin-orders";
import type { AdminOrderDetail, AdminOrderFilterDraft } from "./admin-orders";
import type { Order } from "./purchase";
import { useAdminOrders } from "./useAdminOrders";

const orderLabels: Record<Order["status"], string> = {
  PENDING_PAYMENT: "Aguardando pagamento",
  PAID: "Pagamento confirmado",
  PREPARING: "Em preparação",
  READY_TO_SHIP: "Pronto para envio",
  SHIPPED: "Enviado",
  DELIVERED: "Entregue",
  CANCELLED: "Cancelado",
};
const paymentLabels: Record<string, string> = {
  PENDING: "Em processamento",
  PAID: "Pago",
  FAILED: "Não concluído",
  EXPIRED: "Expirado",
  REFUNDED: "Reembolsado",
  CANCELLED: "Cancelado",
};
const methods: Record<string, string> = {
  PIX: "Pix",
  CREDIT_CARD: "Cartão de crédito",
  DEBIT_CARD: "Cartão de débito",
  BOLETO: "Boleto",
};
const shipmentLabels: Record<string, string> = {
  ACCUMULATING: "Acumulando compras",
  PENDING: "Pendente",
  PREPARING: "Em preparação",
  READY_TO_SHIP: "Pronto para envio",
  SHIPPED: "Postado",
  DELIVERED: "Entregue",
  CANCELLED: "Cancelado",
};
const dateTime = (value: string | null) =>
  value ? new Date(value).toLocaleString("pt-BR") : "Não informado";

function OrderDetail({
  detail,
  onOpenShipment,
}: {
  detail: AdminOrderDetail;
  onOpenShipment?: (id: string) => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [detail.order.id]);
  const order = detail.order;
  const items = new Map(order.items.map((item) => [item.id, item]));
  return (
    <section className="admin-order-detail" aria-label="Detalhes do pedido">
      <h3 ref={heading} tabIndex={-1}>
        Pedido #{order.orderNumber}
      </h3>
      <p className="admin-order-status">{orderLabels[order.status]}</p>
      <section className="admin-order-customer" aria-label="Cliente do pedido">
        <h4>Cliente</h4>
        <p>
          <strong>{detail.customer.name}</strong>
          <br />
          {detail.customer.email}
        </p>
      </section>
      <dl className="admin-order-facts">
        <div>
          <dt>Criado em</dt>
          <dd>{dateTime(order.createdAt)}</dd>
        </div>
        <div>
          <dt>Pagamento confirmado em</dt>
          <dd>{dateTime(order.paidAt)}</dd>
        </div>
        <div>
          <dt>Prazo de pagamento</dt>
          <dd>{dateTime(order.expiresAt)}</dd>
        </div>
        <div>
          <dt>Cancelado em</dt>
          <dd>{dateTime(order.cancelledAt)}</dd>
        </div>
      </dl>
      <h4>Cartas do pedido</h4>
      <ul className="admin-order-items">
        {order.items.map((item) => (
          <li key={item.id}>
            <div>
              <strong>
                {item.quantity}× {item.cardName}
              </strong>
              <small>
                {item.setName} · {item.cardNumber}
              </small>
              <small>
                {item.conditionName} · {item.languageName}
                {item.categoryName ? ` · ${item.categoryName}` : ""}
              </small>
              <small>Valor unitário: {salesMoney(item.unitPrice)}</small>
            </div>
            <strong>{salesMoney(item.totalPrice)}</strong>
          </li>
        ))}
      </ul>
      <dl className="admin-order-totals">
        <div>
          <dt>Subtotal das cartas</dt>
          <dd>{salesMoney(order.subtotal)}</dd>
        </div>
        <div>
          <dt>Desconto do pedido</dt>
          <dd>{salesMoney(order.discountAmount)}</dd>
        </div>
        <div>
          <dt>Frete registrado no pedido</dt>
          <dd>{salesMoney(order.shippingAmount)}</dd>
        </div>
        <div>
          <dt>Total do pedido</dt>
          <dd>{salesMoney(order.total)}</dd>
        </div>
      </dl>
      <p className="admin-orders-help">
        As compras pagas podem permanecer acumuladas e participar de diferentes
        envios. O frete das solicitações é cobrado separadamente.
      </p>
      <h4>Pagamentos das cartas</h4>
      {!detail.payments.length ? (
        <p className="admin-orders-empty">
          Nenhum pagamento registrado para este pedido.
        </p>
      ) : (
        <ul className="admin-order-payments">
          {detail.payments.map((payment) => (
            <li key={payment.id}>
              <strong>
                {methods[payment.method]} · {paymentLabels[payment.status]}
              </strong>
              <p>
                {salesMoney(payment.amount)} · {payment.provider}
              </p>
              <small>
                Criado em {dateTime(payment.createdAt)}
                {payment.paidAt ? ` · Pago em ${dateTime(payment.paidAt)}` : ""}
              </small>
            </li>
          ))}
        </ul>
      )}
      <h4>Envios vinculados</h4>
      {!detail.shipments.length ? (
        <p className="admin-orders-empty">
          Nenhum envio vinculado. As cartas pagas podem continuar acumuladas até
          o cliente solicitar o envio.
        </p>
      ) : (
        <ul className="admin-order-shipments">
          {detail.shipments.map((shipment) => (
            <li key={shipment.id}>
              <strong>{shipmentLabels[shipment.status]}</strong>
              <p>Solicitado em {dateTime(shipment.requestedAt)}</p>
              <p>
                Frete:{" "}
                {shipment.shippingCost === "0.00" && !shipment.shippingPaidAt
                  ? "A calcular"
                  : salesMoney(shipment.shippingCost)}
                {shipment.shippingPaidAt
                  ? " · Pago"
                  : " · Aguardando pagamento"}
              </p>
              {shipment.trackingCode && (
                <p>Rastreio: {shipment.trackingCode}</p>
              )}
              {shipment.shippedAt && (
                <p>Postado em {dateTime(shipment.shippedAt)}</p>
              )}
              {shipment.deliveredAt && (
                <p>Entregue em {dateTime(shipment.deliveredAt)}</p>
              )}
              <ul className="admin-order-shipment-items">
                {shipment.items.map((item) => (
                  <li key={item.orderItemId}>
                    {item.quantity}× {items.get(item.orderItemId)?.cardName}
                  </li>
                ))}
              </ul>
              <p className="admin-orders-help">
                Quantidades deste pedido presentes na solicitação de envio.
              </p>
              {onOpenShipment && (
                <button
                  className="outline"
                  onClick={() => onOpenShipment(shipment.id)}
                >
                  Ver envio
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function AdminOrdersArea({
  isCurrentSession,
  onOpenShipment,
}: {
  isCurrentSession: () => boolean;
  onOpenShipment?: (id: string) => void;
}) {
  const state = useAdminOrders({ isCurrentSession, onOpenShipment });
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  if (!isCurrentSession()) return null;
  if (state.denied)
    return (
      <p className="error" role="alert">
        Acesso restrito a administradores. Entre novamente com uma conta
        autorizada.
      </p>
    );
  const loading = Boolean(state.loading);
  const issue = (key: keyof AdminOrderFilterDraft) =>
    state.validation[key] && (
      <small className="field-error" id={`${id}-${key}-error`}>
        {state.validation[key]}
      </small>
    );
  const described = (key: keyof AdminOrderFilterDraft) =>
    state.validation[key] ? `${id}-${key}-error` : undefined;
  return (
    <section className="admin-orders" aria-label="Pedidos e vendas">
      <p className="admin-orders-help">
        Consulte os pedidos de todos os clientes e acompanhe os pagamentos das
        cartas e os envios solicitados.
      </p>
      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {state.selectedId ? (
        <>
          <div className="admin-orders-toolbar">
            <button className="outline" onClick={state.back}>
              Voltar aos pedidos
            </button>
            <button
              className="outline"
              disabled={loading}
              onClick={state.refresh}
            >
              Atualizar pedido
            </button>
          </div>
          {state.detail && (
            <OrderDetail
              detail={state.detail}
              onOpenShipment={onOpenShipment ? state.openShipment : undefined}
            />
          )}
        </>
      ) : (
        <>
          <div className="admin-orders-toolbar">
            <h3>Consultar pedidos</h3>
            <button
              className="outline"
              disabled={loading}
              onClick={state.refresh}
            >
              Atualizar pedidos
            </button>
          </div>
          <form
            ref={form}
            className="admin-orders-filters"
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
              <label htmlFor={`${id}-status`}>
                Situação
                <select
                  id={`${id}-status`}
                  name="status"
                  value={state.draft.status}
                  disabled={loading}
                  aria-invalid={Boolean(state.validation.status)}
                  aria-describedby={described("status")}
                  onChange={(event) =>
                    state.changeDraft("status", event.target.value)
                  }
                >
                  <option value="">Todas</option>
                  {Object.entries(orderLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              {issue("status")}
            </div>
            <div>
              <label htmlFor={`${id}-orderNumber`}>
                Número do pedido
                <input
                  id={`${id}-orderNumber`}
                  name="orderNumber"
                  value={state.draft.orderNumber}
                  maxLength={10}
                  inputMode="numeric"
                  disabled={loading}
                  aria-invalid={Boolean(state.validation.orderNumber)}
                  aria-describedby={described("orderNumber")}
                  onChange={(event) =>
                    state.changeDraft("orderNumber", event.target.value)
                  }
                />
              </label>
              {issue("orderNumber")}
            </div>
            <div>
              <label htmlFor={`${id}-customer`}>
                Nome ou e-mail do cliente
                <input
                  id={`${id}-customer`}
                  name="customer"
                  value={state.draft.customer}
                  maxLength={200}
                  disabled={loading}
                  aria-invalid={Boolean(state.validation.customer)}
                  aria-describedby={described("customer")}
                  onChange={(event) =>
                    state.changeDraft("customer", event.target.value)
                  }
                />
              </label>
              {issue("customer")}
            </div>
            <div>
              <label htmlFor={`${id}-from`}>
                Criado a partir de
                <input
                  id={`${id}-from`}
                  name="from"
                  type="date"
                  value={state.draft.from}
                  disabled={loading}
                  aria-invalid={Boolean(state.validation.from)}
                  aria-describedby={described("from")}
                  onChange={(event) =>
                    state.changeDraft("from", event.target.value)
                  }
                />
              </label>
              {issue("from")}
            </div>
            <div>
              <label htmlFor={`${id}-to`}>
                Criado até
                <input
                  id={`${id}-to`}
                  name="to"
                  type="date"
                  value={state.draft.to}
                  disabled={loading}
                  aria-invalid={Boolean(state.validation.to)}
                  aria-describedby={described("to")}
                  onChange={(event) =>
                    state.changeDraft("to", event.target.value)
                  }
                />
              </label>
              {issue("to")}
            </div>
            <p className="admin-orders-help">
              Datas no horário deste dispositivo. O período considera a criação
              do pedido.
            </p>
            <div className="button-row">
              <button className="primary" disabled={loading}>
                Aplicar filtros
              </button>
              <button
                className="outline"
                type="button"
                disabled={loading}
                onClick={state.clear}
              >
                Limpar filtros
              </button>
            </div>
          </form>
          {state.list && (
            <>
              <dl
                className="admin-sales-summary"
                aria-label="Resumo dos pedidos filtrados"
              >
                <div>
                  <dt>Pedidos encontrados</dt>
                  <dd>{state.list.summary.orderCount}</dd>
                </div>
                <div>
                  <dt>Aguardando pagamento</dt>
                  <dd>{state.list.summary.pendingCount}</dd>
                </div>
                <div>
                  <dt>Vendas confirmadas</dt>
                  <dd>{state.list.summary.confirmedCount}</dd>
                </div>
                <div>
                  <dt>Valor das cartas vendidas</dt>
                  <dd>{salesMoney(state.list.summary.confirmedAmount)}</dd>
                </div>
              </dl>
              <p className="admin-orders-help">
                O resumo considera todos os pedidos dos filtros aplicados.
                Vendas confirmadas exigem pagamento recebido e nenhum reembolso
                registrado. Valor das cartas após descontos, sem frete. O
                período usa a criação dos pedidos e não representa fluxo de
                caixa.
              </p>
              {!state.list.items.length && (
                <p className="admin-orders-empty">
                  Nenhum pedido encontrado para os filtros aplicados.
                </p>
              )}
              <ul className="admin-order-list">
                {state.list.items.map((order) => (
                  <li className="admin-order-row" key={order.id}>
                    <button
                      className="admin-order-open"
                      aria-label={`Ver pedido #${order.orderNumber}`}
                      disabled={loading}
                      onClick={() => state.open(order.id)}
                    >
                      <div>
                        <h4>Pedido #{order.orderNumber}</h4>
                        <p>{order.customer.name}</p>
                        <small>{order.customer.email}</small>
                        <p className="admin-order-meta">
                          {dateTime(order.createdAt)} · {order.quantity}{" "}
                          {order.quantity === 1 ? "carta" : "cartas"}
                        </p>
                        <span className="admin-order-status">
                          {orderLabels[order.status]}
                        </span>
                      </div>
                      <strong>{salesMoney(order.total)}</strong>
                    </button>
                  </li>
                ))}
              </ul>
              {state.list.total > 20 && (
                <nav
                  className="admin-orders-pagination"
                  aria-label="Páginas de pedidos"
                >
                  <button
                    className="outline"
                    disabled={loading || state.page <= 1}
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
                      loading ||
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
        </>
      )}
      {state.loading && (
        <p className="admin-orders-loading" role="status" aria-busy="true">
          {state.loading === "detail"
            ? "Carregando pedido…"
            : "Carregando pedidos e resumo…"}
        </p>
      )}
      {state.error && (
        <button className="outline" disabled={loading} onClick={state.refresh}>
          Tentar novamente
        </button>
      )}
    </section>
  );
}
