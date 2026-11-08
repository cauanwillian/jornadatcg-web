import { authorized } from "./session";

export const movementLabels = {
  OPENING_BALANCE: "Abertura do histórico",
  INITIAL_STOCK: "Estoque inicial",
  MANUAL_ADJUSTMENT: "Ajuste manual",
  ORDER_RESERVED: "Reserva de pedido",
  ORDER_CANCELLED: "Cancelamento de pedido",
  ORDER_EXPIRED: "Expiração de pedido",
  PAYMENT_CONFIRMED: "Venda confirmada",
  PAYMENT_RELEASED: "Liberação por pagamento",
  STOCK_RECEIPT: "Entrada de estoque",
} as const;
export type MovementType = keyof typeof movementLabels;
export interface StockBalances {
  availableQuantity: number;
  reservedQuantity: number;
  soldQuantity: number;
}
export interface StockMovement {
  id: string;
  sequence: string;
  type: MovementType;
  createdAt: string;
  product: {
    id: string;
    cardName: string;
    cardNumber: string;
    setName: string;
    categoryName: string;
    conditionName: string;
    languageName: string;
  };
  order: { id: string | null; orderNumber: number } | null;
  actor: { id: string; name: string } | null;
  reason: string | null;
  before: StockBalances;
  change: StockBalances;
  after: StockBalances;
}
export interface StockMovementsPage {
  items: StockMovement[];
  page: number;
  pageSize: number;
  total: number;
}
export interface MovementFilters {
  productId?: string;
  type?: MovementType;
  from?: string;
  to?: string;
}
export interface MovementFilterDraft {
  type: string;
  from: string;
  to: string;
}
type FilterErrors = Partial<Record<keyof MovementFilterDraft, string>>;
const maximumQuantity = 2_147_483_647;
const keys = ["availableQuantity", "reservedQuantity", "soldQuantity"] as const;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
const integer = (value: unknown, minimum = 0): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
const text = (value: unknown): value is string =>
  typeof value === "string" && Boolean(value.trim());
const validId = (value: unknown): value is string =>
  typeof value === "string" && uuid.test(value);
const validType = (value: unknown): value is MovementType =>
  typeof value === "string" && Object.hasOwn(movementLabels, value);
const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
function timestamp(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  )
    return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}
function invalid(): never {
  throw Object.assign(new Error("Resposta de movimentações inválida."), {
    code: "INVALID_RESPONSE",
  });
}
function invalidInput(): never {
  throw Object.assign(new Error("Filtros de movimentações inválidos."), {
    status: 400,
  });
}
function calendar(raw: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00`);
  if (!Number.isFinite(date.getTime())) return null;
  const [year, month, day] = raw.split("-").map(Number);
  return date.getFullYear() === year &&
    date.getMonth() + 1 === month &&
    date.getDate() === day
    ? date
    : null;
}
export function validateMovementFilters(draft: MovementFilterDraft): {
  query?: MovementFilters;
  errors: FilterErrors;
} {
  const query: MovementFilters = {};
  const errors: FilterErrors = {};
  if (typeof draft?.type !== "string" || (draft.type && !validType(draft.type)))
    errors.type = "Escolha um tipo de movimentação válido.";
  else if (draft.type) query.type = draft.type as MovementType;
  let start: Date | null = null;
  let end: Date | null = null;
  if (
    typeof draft?.from !== "string" ||
    (draft.from && !(start = calendar(draft.from)))
  )
    errors.from = "Escolha uma data inicial válida.";
  else if (start) query.from = start.toISOString();
  if (
    typeof draft?.to !== "string" ||
    (draft.to && !(end = calendar(draft.to)))
  )
    errors.to = "Escolha uma data final válida.";
  else if (end) {
    end.setDate(end.getDate() + 1);
    end.setHours(0, 0, 0, 0);
    if (timestamp(end.toISOString())) query.to = end.toISOString();
    else errors.to = "Escolha uma data final válida.";
  }
  if (start && end && start >= end)
    errors.to = "A data final deve ser igual ou posterior à inicial.";
  return Object.keys(errors).length ? { errors } : { query, errors };
}
function normalizedFilters(value: MovementFilters): MovementFilters {
  if (
    !object(value) ||
    Object.keys(value).some(
      (key) => !["productId", "type", "from", "to"].includes(key),
    ) ||
    (value.productId !== undefined && !validId(value.productId)) ||
    (value.type !== undefined && !validType(value.type)) ||
    (value.from !== undefined && !timestamp(value.from)) ||
    (value.to !== undefined && !timestamp(value.to)) ||
    (value.from && value.to && value.from >= value.to)
  )
    invalidInput();
  return {
    ...(value.productId ? { productId: value.productId } : {}),
    ...(value.type ? { type: value.type } : {}),
    ...(value.from ? { from: value.from } : {}),
    ...(value.to ? { to: value.to } : {}),
  };
}
function balances(value: unknown, signed = false): StockBalances {
  if (
    !object(value) ||
    keys.some(
      (key) =>
        !integer(value[key], signed ? -maximumQuantity : 0) ||
        value[key] > maximumQuantity,
    )
  )
    invalid();
  return {
    availableQuantity: value.availableQuantity as number,
    reservedQuantity: value.reservedQuantity as number,
    soldQuantity: value.soldQuantity as number,
  };
}
export function parseStockMovement(value: unknown): StockMovement {
  if (
    !object(value) ||
    !validId(value.id) ||
    typeof value.sequence !== "string" ||
    !/^[1-9]\d{0,18}$/.test(value.sequence) ||
    BigInt(value.sequence) > 9_223_372_036_854_775_807n ||
    !validType(value.type) ||
    !timestamp(value.createdAt) ||
    !object(value.product) ||
    !validId(value.product.id) ||
    [
      "cardName",
      "cardNumber",
      "setName",
      "categoryName",
      "conditionName",
      "languageName",
    ].some((key) => !text((value.product as Record<string, unknown>)[key])) ||
    (value.reason !== null &&
      (typeof value.reason !== "string" || value.reason.length > 500))
  )
    invalid();
  const before = balances(value.before),
    change = balances(value.change, true),
    after = balances(value.after);
  if (keys.some((key) => before[key] + change[key] !== after[key])) invalid();
  let order: StockMovement["order"] = null;
  if (value.order !== null) {
    if (
      !object(value.order) ||
      (value.order.id !== null && !validId(value.order.id)) ||
      !integer(value.order.orderNumber, 1) ||
      value.order.orderNumber > maximumQuantity
    )
      invalid();
    order = {
      id: value.order.id as string | null,
      orderNumber: value.order.orderNumber,
    };
  }
  let actor: StockMovement["actor"] = null;
  if (value.actor !== null) {
    if (
      !object(value.actor) ||
      !validId(value.actor.id) ||
      !text(value.actor.name)
    )
      invalid();
    actor = { id: value.actor.id, name: value.actor.name };
  }
  if (
    value.type === "STOCK_RECEIPT" &&
    (change.availableQuantity <= 0 ||
      change.reservedQuantity !== 0 ||
      change.soldQuantity !== 0 ||
      order !== null ||
      typeof value.reason !== "string" ||
      value.reason.trim().length < 3)
  )
    invalid();
  return {
    id: value.id,
    sequence: value.sequence,
    type: value.type,
    createdAt: value.createdAt,
    product: {
      id: value.product.id,
      cardName: value.product.cardName as string,
      cardNumber: value.product.cardNumber as string,
      setName: value.product.setName as string,
      categoryName: value.product.categoryName as string,
      conditionName: value.product.conditionName as string,
      languageName: value.product.languageName as string,
    },
    order,
    actor,
    reason: value.reason as string | null,
    before,
    change,
    after,
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
  }, 15_000);
  try {
    return await Promise.race([
      authorized<unknown>(path, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      }),
      interrupted,
    ]);
  } catch (caught) {
    const status =
      object(caught) && integer(caught.status, 100) && caught.status <= 599
        ? caught.status
        : undefined;
    const code =
      object(caught) && (caught.code === "ABORTED" || caught.code === "TIMEOUT")
        ? caught.code
        : undefined;
    throw Object.assign(
      new Error("Não foi possível consultar as movimentações."),
      status === undefined ? {} : { status },
      code === undefined ? {} : { code },
    );
  } finally {
    window.clearTimeout(timer);
    controller.signal.removeEventListener("abort", stop);
  }
}
export async function fetchStockMovements(
  filters: MovementFilters,
  page: number,
  controller: AbortController,
): Promise<StockMovementsPage> {
  if (!integer(page, 1) || page > 1_000_000) invalidInput();
  const query = normalizedFilters(filters);
  const params = new URLSearchParams({
    page: String(page),
    pageSize: "20",
    ...query,
  });
  const value = await request(
    `/admin/inventory/movements?${params}`,
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
  const items = value.items.map(parseStockMovement);
  if (
    new Set(items.map((item) => item.id.toLowerCase())).size !== items.length ||
    new Set(items.map((item) => item.sequence)).size !== items.length ||
    items.some(
      (item, index) =>
        (index > 0 &&
          BigInt(items[index - 1].sequence) <= BigInt(item.sequence)) ||
        (query.productId && !sameId(item.product.id, query.productId)) ||
        (query.type && item.type !== query.type) ||
        (query.from && item.createdAt < query.from) ||
        (query.to && item.createdAt >= query.to),
    )
  )
    invalid();
  return { items, page, pageSize: 20, total: value.total };
}
export function movementError(error: unknown): string {
  const status =
    object(error) && integer(error.status) ? error.status : undefined;
  const code = object(error) ? error.code : undefined;
  if (status === 401)
    return "Sua sessão expirou. Entre novamente com uma conta de administrador.";
  if (status === 403)
    return "Acesso restrito a administradores. Entre com uma conta autorizada.";
  if (status === 400) return "Confira os filtros antes de consultar novamente.";
  if (status === 429)
    return "Muitas consultas. Aguarde um pouco antes de tentar novamente.";
  if (code === "TIMEOUT" || status === 408 || status === 504)
    return "A consulta demorou mais que o esperado. Tente novamente em instantes.";
  if (code === "INVALID_RESPONSE")
    return "Não foi possível conferir os registros. Atualize o histórico.";
  return "Não foi possível carregar o histórico de estoque. Tente novamente em instantes.";
}
