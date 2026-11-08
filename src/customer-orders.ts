import { authorized } from "./session";
import type { Order, OrdersPage, PixResult } from "./purchase";

export type OrderPayment = PixResult["payment"];
export interface CancellationReview {
  order: Order;
  payments: OrderPayment[];
  canCancel: boolean;
}
type OrderAction = "list" | "review" | "cancel";
const orderStatuses = new Set<Order["status"]>([
  "PENDING_PAYMENT",
  "PAID",
  "PREPARING",
  "READY_TO_SHIP",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
]);
const paymentStatuses = new Set<OrderPayment["status"]>([
  "PENDING",
  "PAID",
  "FAILED",
  "EXPIRED",
  "REFUNDED",
  "CANCELLED",
]);
const paymentMethods = new Set<OrderPayment["method"]>([
  "PIX",
  "CREDIT_CARD",
  "DEBIT_CARD",
  "BOLETO",
]);
const nonBlockingPayments = new Set<OrderPayment["status"]>([
  "FAILED",
  "EXPIRED",
  "CANCELLED",
]);
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
const integer = (value: unknown, minimum = 0): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
const text = (value: unknown): value is string =>
  typeof value === "string" && Boolean(value.trim());
const amount = (value: unknown): value is string =>
  typeof value === "string" && /^(0|[1-9]\d{0,9})\.\d{2}$/.test(value);
const date = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T/.test(value) &&
  Number.isFinite(Date.parse(value));
const nullableDate = (value: unknown): value is string | null =>
  value === null || date(value);
function invalid(): never {
  throw Object.assign(new Error("Resposta de pedido inválida."), {
    code: "INVALID_RESPONSE",
  });
}
function invalidInput(): never {
  throw Object.assign(new Error("Pedido ou página inválidos."), {
    status: 400,
  });
}
function validId(id: unknown): id is string {
  return typeof id === "string" && uuid.test(id);
}

function parseItem(value: unknown): Order["items"][number] {
  if (
    !object(value) ||
    !text(value.id) ||
    !(value.productId === null || text(value.productId)) ||
    !text(value.cardName) ||
    !text(value.cardNumber) ||
    !text(value.setName) ||
    !text(value.conditionName) ||
    !text(value.languageName) ||
    !text(value.categoryName) ||
    !integer(value.quantity, 1) ||
    !amount(value.unitPrice) ||
    !amount(value.totalPrice)
  )
    invalid();
  return {
    id: value.id,
    productId: value.productId,
    cardName: value.cardName,
    cardNumber: value.cardNumber,
    setName: value.setName,
    conditionName: value.conditionName,
    languageName: value.languageName,
    categoryName: value.categoryName,
    quantity: value.quantity,
    unitPrice: value.unitPrice,
    totalPrice: value.totalPrice,
  };
}
function parseOrder(value: unknown, expectedId?: string): Order {
  if (
    !object(value) ||
    !validId(value.id) ||
    (expectedId !== undefined &&
      value.id.toLowerCase() !== expectedId.toLowerCase()) ||
    !integer(value.orderNumber, 1) ||
    typeof value.status !== "string" ||
    !orderStatuses.has(value.status as Order["status"]) ||
    !amount(value.subtotal) ||
    !amount(value.shippingAmount) ||
    !amount(value.discountAmount) ||
    !amount(value.total) ||
    !date(value.createdAt) ||
    !date(value.updatedAt) ||
    !nullableDate(value.paidAt) ||
    !nullableDate(value.expiresAt) ||
    !nullableDate(value.cancelledAt) ||
    !Array.isArray(value.items) ||
    value.items.length === 0
  )
    invalid();
  const items = value.items.map(parseItem);
  if (new Set(items.map((item) => item.id)).size !== items.length) invalid();
  return {
    id: value.id,
    orderNumber: value.orderNumber,
    status: value.status as Order["status"],
    subtotal: value.subtotal,
    shippingAmount: value.shippingAmount,
    discountAmount: value.discountAmount,
    total: value.total,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    paidAt: value.paidAt,
    expiresAt: value.expiresAt,
    cancelledAt: value.cancelledAt,
    items,
  };
}
function parsePayment(value: unknown, orderId: string): OrderPayment {
  if (
    !object(value) ||
    !text(value.id) ||
    typeof value.orderId !== "string" ||
    value.orderId.toLowerCase() !== orderId.toLowerCase() ||
    value.shipmentId !== null ||
    !text(value.provider) ||
    typeof value.method !== "string" ||
    !paymentMethods.has(value.method as OrderPayment["method"]) ||
    typeof value.status !== "string" ||
    !paymentStatuses.has(value.status as OrderPayment["status"]) ||
    !amount(value.amount) ||
    !integer(value.installments, 1) ||
    !date(value.createdAt) ||
    !date(value.updatedAt) ||
    !nullableDate(value.paidAt) ||
    !nullableDate(value.failedAt) ||
    !nullableDate(value.expiresAt)
  )
    invalid();
  return {
    id: value.id,
    orderId: value.orderId,
    shipmentId: null,
    provider: value.provider,
    method: value.method as OrderPayment["method"],
    status: value.status as OrderPayment["status"],
    amount: value.amount,
    installments: value.installments,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    paidAt: value.paidAt,
    failedAt: value.failedAt,
    expiresAt: value.expiresAt,
  };
}

/** A browser clock or a missing Pix is never evidence that a payment is absent. */
export function canCancelOrder(
  order: Order,
  payments: OrderPayment[],
): boolean {
  return Boolean(
    order &&
    validId(order.id) &&
    order.status === "PENDING_PAYMENT" &&
    Array.isArray(payments) &&
    payments.every(
      (payment) =>
        payment &&
        typeof payment.orderId === "string" &&
        payment.orderId.toLowerCase() === order.id.toLowerCase() &&
        payment.shipmentId === null &&
        paymentMethods.has(payment.method) &&
        nonBlockingPayments.has(payment.status),
    ),
  );
}

async function bounded<T>(
  controller: AbortController,
  task: () => Promise<T>,
): Promise<T> {
  if (controller.signal.aborted)
    throw Object.assign(new Error("Consulta interrompida."), {
      code: "ABORTED",
    });
  let timedOut = false;
  let stop!: () => void;
  const interrupted = new Promise<never>((_, reject) => {
    stop = () =>
      reject(
        Object.assign(new Error("Consulta interrompida."), {
          code: timedOut ? "TIMEOUT" : "ABORTED",
        }),
      );
    controller.signal.addEventListener("abort", stop, { once: true });
  });
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 15_000);
  try {
    return await Promise.race([task(), interrupted]);
  } catch (caught) {
    const status =
      object(caught) && integer(caught.status, 100) && caught.status <= 599
        ? caught.status
        : undefined;
    const code =
      object(caught) &&
      ["ABORTED", "TIMEOUT", "INVALID_RESPONSE"].includes(String(caught.code))
        ? caught.code
        : undefined;
    throw Object.assign(
      new Error("Não foi possível consultar ou cancelar o pedido."),
      status === undefined ? {} : { status },
      code === undefined ? {} : { code },
    );
  } finally {
    window.clearTimeout(timer);
    controller.signal.removeEventListener("abort", stop);
  }
}
const get = (path: string, controller: AbortController) =>
  authorized<unknown>(path, {
    method: "GET",
    signal: controller.signal,
    cache: "no-store",
  });

export async function fetchCustomerOrders(
  page: number,
  controller: AbortController,
): Promise<OrdersPage> {
  if (!integer(page, 1) || page > 1_000_000) invalidInput();
  return bounded(controller, async () => {
    const value = await get(`/orders?page=${page}&pageSize=20`, controller);
    if (
      !object(value) ||
      value.page !== page ||
      value.pageSize !== 20 ||
      !integer(value.total) ||
      !Array.isArray(value.items) ||
      value.items.length !==
        Math.min(20, Math.max(0, value.total - (page - 1) * 20))
    )
      invalid();
    const items = value.items.map((item) => parseOrder(item));
    if (
      new Set(items.map((item) => item.id.toLowerCase())).size !== items.length
    )
      invalid();
    return { items, page, pageSize: 20, total: value.total };
  });
}
export async function inspectOrderCancellation(
  id: string,
  controller: AbortController,
): Promise<CancellationReview> {
  if (!validId(id)) invalidInput();
  return bounded(controller, async () => {
    const [detail, history] = await Promise.all([
      get(`/orders/${id}`, controller),
      get(`/orders/${id}/payments`, controller),
    ]);
    const order = parseOrder(detail, id);
    if (!Array.isArray(history)) invalid();
    const payments = history.map((payment) => parsePayment(payment, id));
    if (new Set(payments.map((payment) => payment.id)).size !== payments.length)
      invalid();
    return { order, payments, canCancel: canCancelOrder(order, payments) };
  });
}
export async function cancelCustomerOrder(
  id: string,
  controller: AbortController,
): Promise<Order> {
  if (!validId(id)) invalidInput();
  return bounded(controller, async () => {
    const value = await authorized<unknown>(`/orders/${id}/cancel`, {
      method: "POST",
      signal: controller.signal,
      cache: "no-store",
    });
    const order = parseOrder(value, id);
    if (order.status !== "CANCELLED") invalid();
    return order;
  });
}

export function orderActionError(error: unknown, action: OrderAction): string {
  const status =
    object(error) && integer(error.status) ? error.status : undefined;
  const code = object(error) ? error.code : undefined;
  if (status === 401)
    return "Sua sessão expirou. Entre novamente para consultar seus pedidos.";
  if (status === 403)
    return "Não foi possível acessar seus pedidos. Entre novamente com sua conta.";
  if (status === 404)
    return "Pedido não encontrado. Atualize a lista de pedidos antes de continuar.";
  if (status === 409)
    return "O pedido mudou ou não permite cancelamento. Atualize os dados antes de continuar.";
  if (status === 429)
    return "Muitas solicitações. Aguarde um pouco antes de tentar novamente.";
  if (action === "cancel")
    return code === "TIMEOUT" || status === 408 || status === 504
      ? "O cancelamento demorou mais que o esperado e pode ter sido concluído. Consulte a situação do pedido antes de tentar novamente."
      : "Não foi possível confirmar o cancelamento. Ele pode ter sido concluído. Consulte a situação do pedido antes de tentar novamente.";
  if (code === "TIMEOUT" || status === 408 || status === 504)
    return "A consulta dos pedidos demorou mais que o esperado. Atualize os dados para tentar novamente.";
  if (code === "INVALID_RESPONSE")
    return "Não foi possível conferir os dados do pedido. Atualize a consulta antes de continuar.";
  return action === "review"
    ? "Não foi possível conferir o pedido e seus pagamentos. Atualize os dados antes de tentar cancelar."
    : "Não foi possível carregar seus pedidos. Atualize a lista para tentar novamente.";
}
