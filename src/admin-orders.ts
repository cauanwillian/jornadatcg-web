import { authorized } from "./session";
import type { Order, PixResult } from "./purchase";

export interface AdminCustomer {
  id: string;
  name: string;
  email: string;
}
export interface AdminOrderRow {
  id: string;
  orderNumber: number;
  status: Order["status"];
  total: string;
  createdAt: string;
  paidAt: string | null;
  cancelledAt: string | null;
  customer: AdminCustomer;
  quantity: number;
}
export interface SalesSummary {
  orderCount: number;
  pendingCount: number;
  confirmedCount: number;
  confirmedAmount: string;
}
export interface AdminOrdersPage {
  items: AdminOrderRow[];
  page: number;
  pageSize: number;
  total: number;
  summary: SalesSummary;
}
export type AdminOrderItem = Omit<Order["items"][number], "categoryName"> & {
  categoryName: string | null;
};
export type AdminOrder = Omit<Order, "items"> & { items: AdminOrderItem[] };
export interface AdminOrderShipment {
  id: string;
  status:
    | "ACCUMULATING"
    | "PENDING"
    | "PREPARING"
    | "READY_TO_SHIP"
    | "SHIPPED"
    | "DELIVERED"
    | "CANCELLED";
  requestedAt: string;
  shippedAt: string | null;
  deliveredAt: string | null;
  trackingCode: string | null;
  shippingCost: string;
  shippingPaidAt: string | null;
  items: Array<{ orderItemId: string; quantity: number }>;
}
export interface AdminOrderDetail {
  order: AdminOrder;
  customer: AdminCustomer;
  payments: PixResult["payment"][];
  shipments: AdminOrderShipment[];
}
export interface AdminOrderFilters {
  status?: Order["status"];
  orderNumber?: string;
  customer?: string;
  from?: string;
  to?: string;
}
export interface AdminOrderFilterDraft {
  status: string;
  orderNumber: string;
  customer: string;
  from: string;
  to: string;
}
type FilterErrors = Partial<Record<keyof AdminOrderFilterDraft, string>>;
const statuses = new Set([
  "PENDING_PAYMENT",
  "PAID",
  "PREPARING",
  "READY_TO_SHIP",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
]);
const paymentStatuses = new Set([
  "PENDING",
  "PAID",
  "FAILED",
  "EXPIRED",
  "REFUNDED",
  "CANCELLED",
]);
const paymentMethods = new Set(["PIX", "CREDIT_CARD", "DEBIT_CARD", "BOLETO"]);
const shipmentStatuses = new Set([
  "ACCUMULATING",
  "PENDING",
  "PREPARING",
  "READY_TO_SHIP",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
]);
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
const text = (value: unknown): value is string =>
  typeof value === "string" && Boolean(value.trim());
const integer = (value: unknown, min = 0): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= min;
const validId = (value: unknown): value is string =>
  typeof value === "string" && uuid.test(value);
const money = (value: unknown): value is string =>
  typeof value === "string" && /^(0|[1-9]\d{0,9})\.\d{2}$/.test(value);
const aggregateMoney = (value: unknown): value is string =>
  typeof value === "string" && /^(0|[1-9]\d{0,63})\.\d{2}$/.test(value);
const controls = (value: string) =>
  Array.from(value).some(
    (character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
  );
const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const uniqueIds = (rows: { id: string }[]) =>
  new Set(rows.map((row) => row.id.toLowerCase())).size === rows.length;
function timestamp(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  )
    return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}
const nullableDate = (value: unknown): value is string | null =>
  value === null || timestamp(value);
function invalid(): never {
  throw Object.assign(new Error("Resposta de pedidos inválida."), {
    code: "INVALID_RESPONSE",
  });
}
function invalidInput(): never {
  throw Object.assign(new Error("Filtros de pedidos inválidos."), {
    status: 400,
  });
}

function calendarDate(raw: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const parsed = new Date(`${raw}T00:00:00`);
  if (!Number.isFinite(parsed.getTime())) return null;
  const [year, month, day] = raw.split("-").map(Number);
  return parsed.getFullYear() === year &&
    parsed.getMonth() + 1 === month &&
    parsed.getDate() === day
    ? parsed
    : null;
}

export function validateAdminOrderFilters(draft: AdminOrderFilterDraft): {
  query?: AdminOrderFilters;
  errors: FilterErrors;
} {
  const errors: FilterErrors = {};
  const query: AdminOrderFilters = {};
  if (
    typeof draft?.status !== "string" ||
    (draft.status && !statuses.has(draft.status))
  )
    errors.status = "Escolha uma situação válida.";
  else if (draft.status) query.status = draft.status as Order["status"];
  const number =
    typeof draft?.orderNumber === "string" ? draft.orderNumber.trim() : "";
  if (
    typeof draft?.orderNumber !== "string" ||
    (number && (!/^[1-9]\d*$/.test(number) || Number(number) > 2_147_483_647))
  )
    errors.orderNumber = "Informe um número de pedido entre 1 e 2.147.483.647.";
  else if (number) query.orderNumber = number;
  if (
    typeof draft?.customer !== "string" ||
    draft.customer.length > 200 ||
    controls(draft.customer)
  )
    errors.customer = "Informe nome ou e-mail com até 200 caracteres válidos.";
  else if (draft.customer.trim()) query.customer = draft.customer.trim();
  let start: Date | null = null;
  let end: Date | null = null;
  if (
    typeof draft?.from !== "string" ||
    (draft.from && !(start = calendarDate(draft.from)))
  )
    errors.from = "Escolha uma data inicial válida.";
  else if (start) query.from = start.toISOString();
  if (
    typeof draft?.to !== "string" ||
    (draft.to && !(end = calendarDate(draft.to)))
  )
    errors.to = "Escolha uma data final válida.";
  else if (end) {
    end.setDate(end.getDate() + 1);
    // A missing midnight may normalize to 01:00; reset the next day's time.
    end.setHours(0, 0, 0, 0);
    const value = end.toISOString();
    if (!timestamp(value)) errors.to = "Escolha uma data final válida.";
    else query.to = value;
  }
  if (start && end && start >= end)
    errors.to = "A data final deve ser igual ou posterior à inicial.";
  return Object.keys(errors).length ? { errors } : { query, errors };
}

function normalizedFilters(value: AdminOrderFilters): AdminOrderFilters {
  if (
    !object(value) ||
    Object.keys(value).some(
      (key) =>
        !["status", "orderNumber", "customer", "from", "to"].includes(key),
    )
  )
    invalidInput();
  if (
    value.status !== undefined &&
    (typeof value.status !== "string" || !statuses.has(value.status))
  )
    invalidInput();
  if (
    value.orderNumber !== undefined &&
    (typeof value.orderNumber !== "string" ||
      !/^[1-9]\d*$/.test(value.orderNumber) ||
      Number(value.orderNumber) > 2_147_483_647)
  )
    invalidInput();
  if (
    value.customer !== undefined &&
    (typeof value.customer !== "string" ||
      !value.customer.trim() ||
      value.customer.length > 200 ||
      controls(value.customer))
  )
    invalidInput();
  if (
    (value.from !== undefined && !timestamp(value.from)) ||
    (value.to !== undefined && !timestamp(value.to))
  )
    invalidInput();
  if (value.from && value.to && value.from >= value.to) invalidInput();
  return {
    ...(value.status ? { status: value.status as Order["status"] } : {}),
    ...(value.orderNumber ? { orderNumber: value.orderNumber } : {}),
    ...(value.customer ? { customer: value.customer.trim() } : {}),
    ...(value.from ? { from: value.from } : {}),
    ...(value.to ? { to: value.to } : {}),
  };
}
function customer(value: unknown): AdminCustomer {
  if (
    !object(value) ||
    !validId(value.id) ||
    !text(value.name) ||
    typeof value.email !== "string" ||
    value.email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)
  )
    invalid();
  return { id: value.id, name: value.name, email: value.email };
}
function row(value: unknown): AdminOrderRow {
  if (
    !object(value) ||
    !validId(value.id) ||
    !integer(value.orderNumber, 1) ||
    value.orderNumber > 2_147_483_647 ||
    typeof value.status !== "string" ||
    !statuses.has(value.status) ||
    !money(value.total) ||
    !timestamp(value.createdAt) ||
    !nullableDate(value.paidAt) ||
    !nullableDate(value.cancelledAt) ||
    !integer(value.quantity, 1)
  )
    invalid();
  return {
    id: value.id,
    orderNumber: value.orderNumber,
    status: value.status as Order["status"],
    total: value.total,
    createdAt: value.createdAt,
    paidAt: value.paidAt,
    cancelledAt: value.cancelledAt,
    customer: customer(value.customer),
    quantity: value.quantity,
  };
}
function summary(value: unknown, total: number): SalesSummary {
  if (
    !object(value) ||
    value.orderCount !== total ||
    !integer(value.pendingCount) ||
    !integer(value.confirmedCount) ||
    value.pendingCount + value.confirmedCount > total ||
    !aggregateMoney(value.confirmedAmount) ||
    (value.confirmedCount === 0 && value.confirmedAmount !== "0.00")
  )
    invalid();
  return {
    orderCount: total,
    pendingCount: value.pendingCount,
    confirmedCount: value.confirmedCount,
    confirmedAmount: value.confirmedAmount,
  };
}
function item(value: unknown): AdminOrderItem {
  if (
    !object(value) ||
    !text(value.id) ||
    !(value.productId === null || text(value.productId)) ||
    !text(value.cardName) ||
    !text(value.cardNumber) ||
    !text(value.setName) ||
    !text(value.conditionName) ||
    !text(value.languageName) ||
    !(value.categoryName === null || typeof value.categoryName === "string") ||
    !integer(value.quantity, 1) ||
    !money(value.unitPrice) ||
    !money(value.totalPrice)
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
function order(value: unknown, id: string): AdminOrder {
  if (
    !object(value) ||
    !validId(value.id) ||
    !sameId(value.id, id) ||
    !integer(value.orderNumber, 1) ||
    value.orderNumber > 2_147_483_647 ||
    typeof value.status !== "string" ||
    !statuses.has(value.status) ||
    !["subtotal", "shippingAmount", "discountAmount", "total"].every((key) =>
      money(value[key]),
    ) ||
    !timestamp(value.createdAt) ||
    !timestamp(value.updatedAt) ||
    !["paidAt", "expiresAt", "cancelledAt"].every((key) =>
      nullableDate(value[key]),
    ) ||
    !Array.isArray(value.items) ||
    value.items.length === 0
  )
    invalid();
  const items = value.items.map(item);
  if (!uniqueIds(items)) invalid();
  return {
    id: value.id,
    orderNumber: value.orderNumber,
    status: value.status as Order["status"],
    subtotal: value.subtotal as string,
    shippingAmount: value.shippingAmount as string,
    discountAmount: value.discountAmount as string,
    total: value.total as string,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    paidAt: value.paidAt as string | null,
    expiresAt: value.expiresAt as string | null,
    cancelledAt: value.cancelledAt as string | null,
    items,
  };
}
function payment(value: unknown, id: string): PixResult["payment"] {
  if (
    !object(value) ||
    !text(value.id) ||
    typeof value.orderId !== "string" ||
    !sameId(value.orderId, id) ||
    value.shipmentId !== null ||
    !text(value.provider) ||
    typeof value.method !== "string" ||
    !paymentMethods.has(value.method) ||
    typeof value.status !== "string" ||
    !paymentStatuses.has(value.status) ||
    !money(value.amount) ||
    !integer(value.installments, 1) ||
    !timestamp(value.createdAt) ||
    !timestamp(value.updatedAt) ||
    !["paidAt", "failedAt", "expiresAt"].every((key) =>
      nullableDate(value[key]),
    )
  )
    invalid();
  return {
    id: value.id,
    orderId: value.orderId,
    shipmentId: null,
    provider: value.provider,
    method: value.method as PixResult["payment"]["method"],
    status: value.status as PixResult["payment"]["status"],
    amount: value.amount,
    installments: value.installments,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    paidAt: value.paidAt as string | null,
    failedAt: value.failedAt as string | null,
    expiresAt: value.expiresAt as string | null,
  };
}
function shipment(
  value: unknown,
  purchased: Map<string, number>,
): AdminOrderShipment {
  if (
    !object(value) ||
    !validId(value.id) ||
    typeof value.status !== "string" ||
    !shipmentStatuses.has(value.status) ||
    !timestamp(value.requestedAt) ||
    !["shippedAt", "deliveredAt", "shippingPaidAt"].every((key) =>
      nullableDate(value[key]),
    ) ||
    !(value.trackingCode === null || typeof value.trackingCode === "string") ||
    !money(value.shippingCost) ||
    !Array.isArray(value.items) ||
    value.items.length === 0
  )
    invalid();
  const items = value.items.map((entry) => {
    if (
      !object(entry) ||
      !text(entry.orderItemId) ||
      !integer(entry.quantity, 1) ||
      !purchased.has(entry.orderItemId.toLowerCase()) ||
      entry.quantity > purchased.get(entry.orderItemId.toLowerCase())!
    )
      invalid();
    return { orderItemId: entry.orderItemId, quantity: entry.quantity };
  });
  if (
    new Set(items.map((entry) => entry.orderItemId.toLowerCase())).size !==
    items.length
  )
    invalid();
  return {
    id: value.id,
    status: value.status as AdminOrderShipment["status"],
    requestedAt: value.requestedAt,
    shippedAt: value.shippedAt as string | null,
    deliveredAt: value.deliveredAt as string | null,
    trackingCode: value.trackingCode,
    shippingCost: value.shippingCost,
    shippingPaidAt: value.shippingPaidAt as string | null,
    items,
  };
}

async function request(
  path: string,
  controller: AbortController,
): Promise<unknown> {
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
  }, 15000);
  try {
    return await Promise.race([
      authorized<unknown>(path, {
        method: "GET",
        signal: controller.signal,
        cache: "no-store",
      }),
      interrupted,
    ]);
  } catch (caught) {
    const status =
      object(caught) && integer(caught.status, 100) && caught.status <= 599
        ? caught.status
        : undefined;
    const code =
      object(caught) && ["ABORTED", "TIMEOUT"].includes(String(caught.code))
        ? caught.code
        : undefined;
    throw Object.assign(
      new Error("Não foi possível consultar os pedidos da loja."),
      status === undefined ? {} : { status },
      code === undefined ? {} : { code },
    );
  } finally {
    window.clearTimeout(timer);
    controller.signal.removeEventListener("abort", stop);
  }
}
export async function fetchAdminOrders(
  filters: AdminOrderFilters,
  page: number,
  controller: AbortController,
): Promise<AdminOrdersPage> {
  if (!integer(page, 1) || page > 1_000_000) invalidInput();
  const query = normalizedFilters(filters);
  const value = await request(
    `/admin/orders?${new URLSearchParams({ page: String(page), pageSize: "20", ...query })}`,
    controller,
  );
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
  const items = value.items.map(row);
  if (!uniqueIds(items)) invalid();
  return {
    items,
    page,
    pageSize: 20,
    total: value.total,
    summary: summary(value.summary, value.total),
  };
}
export async function fetchAdminOrder(
  id: string,
  controller: AbortController,
): Promise<AdminOrderDetail> {
  if (!validId(id)) invalidInput();
  const value = await request(`/admin/orders/${id}`, controller);
  if (
    !object(value) ||
    !Array.isArray(value.payments) ||
    !Array.isArray(value.shipments)
  )
    invalid();
  const detail = order(value.order, id);
  const payments = value.payments.map((entry) => payment(entry, id));
  const purchased = new Map(
    detail.items.map((entry) => [entry.id.toLowerCase(), entry.quantity]),
  );
  const shipments = value.shipments.map((entry) => shipment(entry, purchased));
  if (!uniqueIds(payments) || !uniqueIds(shipments)) invalid();
  return {
    order: detail,
    customer: customer(value.customer),
    payments,
    shipments,
  };
}
const integerFormat = new Intl.NumberFormat("pt-BR");
export function salesMoney(value: string): string {
  if (!aggregateMoney(value)) return "Valor indisponível";
  const [whole, cents] = value.split(".");
  return `R$\u00a0${integerFormat.format(BigInt(whole!))},${cents}`;
}
export function adminOrderError(error: unknown): string {
  const status =
    object(error) && integer(error.status) ? error.status : undefined;
  const code = object(error) ? error.code : undefined;
  if (status === 401)
    return "Sua sessão expirou. Entre novamente com uma conta de administrador.";
  if (status === 403)
    return "Acesso restrito a administradores. Entre com uma conta autorizada.";
  if (status === 400)
    return "Confira os filtros informados antes de consultar novamente.";
  if (status === 404)
    return "Pedido não encontrado. Atualize a lista de pedidos.";
  if (status === 429)
    return "Muitas consultas. Aguarde um pouco antes de tentar novamente.";
  if (code === "TIMEOUT" || status === 408 || status === 504)
    return "A consulta demorou mais que o esperado. Tente novamente em instantes.";
  if (code === "INVALID_RESPONSE")
    return "Não foi possível conferir os dados de pedidos e vendas. Atualize a consulta.";
  return "Não foi possível carregar os pedidos e vendas da loja. Tente novamente em instantes.";
}
