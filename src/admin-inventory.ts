import { authorized } from "./session";

export type InventoryStock =
  "available" | "out" | "low" | "reserved" | "missing";
interface NamedReference {
  id: string;
  name: string;
}
export interface InventoryRow {
  id: string;
  active: boolean;
  card: NamedReference & { number: string; set: NamedReference };
  category: NamedReference;
  condition: NamedReference;
  language: NamedReference;
  inventory: {
    availableQuantity: number;
    reservedQuantity: number;
    soldQuantity: number;
    updatedAt: string;
  } | null;
}
export interface InventorySummary {
  productCount: number;
  availableCount: number;
  outOfStockCount: number;
  lowStockCount: number;
  reservedCount: number;
  missingInventoryCount: number;
}
export interface InventoryPage {
  items: InventoryRow[];
  page: number;
  pageSize: number;
  total: number;
  lowStockThreshold: number;
  summary: InventorySummary;
}
export interface InventoryFilters {
  name?: string;
  active?: "true" | "false";
  stock?: InventoryStock;
  lowStockThreshold: number;
}
export interface InventoryFilterDraft {
  name: string;
  active: string;
  stock: string;
  lowStockThreshold: string;
}
type FilterErrors = Partial<Record<keyof InventoryFilterDraft, string>>;
const maximumQuantity = 2_147_483_647;
const stockValues = new Set<InventoryStock>([
  "available",
  "out",
  "low",
  "reserved",
  "missing",
]);
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
const integer = (value: unknown, minimum = 0): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
const quantity = (value: unknown): value is number =>
  integer(value) && value <= maximumQuantity;
const text = (value: unknown): value is string =>
  typeof value === "string" && Boolean(value.trim());
const validId = (value: unknown): value is string =>
  typeof value === "string" && uuid.test(value);
const controlCharacters = (value: string) =>
  Array.from(value).some(
    (character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
  );
const validStock = (value: unknown): value is InventoryStock =>
  typeof value === "string" && stockValues.has(value as InventoryStock);
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
  throw Object.assign(new Error("Resposta de estoque inválida."), {
    code: "INVALID_RESPONSE",
  });
}
function invalidInput(): never {
  throw Object.assign(new Error("Filtros de estoque inválidos."), {
    status: 400,
  });
}

export function validateInventoryFilters(draft: InventoryFilterDraft): {
  query?: InventoryFilters;
  errors: FilterErrors;
} {
  const errors: FilterErrors = {};
  const query: InventoryFilters = { lowStockThreshold: 5 };
  if (
    typeof draft?.name !== "string" ||
    draft.name.length > 200 ||
    controlCharacters(draft.name)
  )
    errors.name = "Informe um nome com até 200 caracteres válidos.";
  else if (draft.name.trim()) query.name = draft.name.trim();
  if (
    typeof draft?.active !== "string" ||
    !["", "true", "false"].includes(draft.active)
  )
    errors.active = "Escolha uma situação de anúncio válida.";
  else if (draft.active) query.active = draft.active as "true" | "false";
  if (
    typeof draft?.stock !== "string" ||
    (draft.stock && !validStock(draft.stock))
  )
    errors.stock = "Escolha uma situação de estoque válida.";
  else if (draft.stock) query.stock = draft.stock as InventoryStock;
  const threshold =
    typeof draft?.lowStockThreshold === "string"
      ? draft.lowStockThreshold.trim()
      : "";
  if (!/^[1-9]\d*$/.test(threshold) || Number(threshold) > maximumQuantity)
    errors.lowStockThreshold =
      "Informe um limite inteiro entre 1 e 2.147.483.647.";
  else query.lowStockThreshold = Number(threshold);
  return Object.keys(errors).length ? { errors } : { query, errors };
}
function normalizedFilters(value: InventoryFilters): InventoryFilters {
  if (
    !object(value) ||
    Object.keys(value).some(
      (key) => !["name", "active", "stock", "lowStockThreshold"].includes(key),
    ) ||
    !integer(value.lowStockThreshold, 1) ||
    value.lowStockThreshold > maximumQuantity
  )
    invalidInput();
  if (
    value.name !== undefined &&
    (typeof value.name !== "string" ||
      !value.name.trim() ||
      value.name.length > 200 ||
      controlCharacters(value.name))
  )
    invalidInput();
  if (
    value.active !== undefined &&
    value.active !== "true" &&
    value.active !== "false"
  )
    invalidInput();
  if (value.stock !== undefined && !validStock(value.stock)) invalidInput();
  return {
    lowStockThreshold: value.lowStockThreshold,
    ...(value.name ? { name: value.name.trim() } : {}),
    ...(value.active === undefined ? {} : { active: value.active }),
    ...(value.stock === undefined ? {} : { stock: value.stock }),
  };
}
function reference(value: unknown): NamedReference {
  if (!object(value) || !validId(value.id) || !text(value.name)) invalid();
  return { id: value.id, name: value.name };
}
function row(value: unknown): InventoryRow {
  if (
    !object(value) ||
    !validId(value.id) ||
    typeof value.active !== "boolean" ||
    !object(value.card) ||
    !text(value.card.number)
  )
    invalid();
  const card = reference(value.card);
  let inventory: InventoryRow["inventory"] = null;
  if (value.inventory !== null) {
    if (
      !object(value.inventory) ||
      !quantity(value.inventory.availableQuantity) ||
      !quantity(value.inventory.reservedQuantity) ||
      !quantity(value.inventory.soldQuantity) ||
      !timestamp(value.inventory.updatedAt)
    )
      invalid();
    inventory = {
      availableQuantity: value.inventory.availableQuantity,
      reservedQuantity: value.inventory.reservedQuantity,
      soldQuantity: value.inventory.soldQuantity,
      updatedAt: value.inventory.updatedAt,
    };
  }
  return {
    id: value.id,
    active: value.active,
    card: {
      ...card,
      number: value.card.number,
      set: reference(value.card.set),
    },
    category: reference(value.category),
    condition: reference(value.condition),
    language: reference(value.language),
    inventory,
  };
}
function buckets(value: InventoryRow, threshold: number) {
  return {
    availableCount:
      value.inventory !== null && value.inventory.availableQuantity > 0,
    outOfStockCount:
      value.inventory !== null && value.inventory.availableQuantity === 0,
    lowStockCount:
      value.inventory !== null &&
      value.inventory.availableQuantity > 0 &&
      value.inventory.availableQuantity <= threshold,
    reservedCount:
      value.inventory !== null && value.inventory.reservedQuantity > 0,
    missingInventoryCount: value.inventory === null,
  };
}
const bucketNames = [
  "availableCount",
  "outOfStockCount",
  "lowStockCount",
  "reservedCount",
  "missingInventoryCount",
] as const;
const stockBucket: Record<InventoryStock, (typeof bucketNames)[number]> = {
  available: "availableCount",
  out: "outOfStockCount",
  low: "lowStockCount",
  reserved: "reservedCount",
  missing: "missingInventoryCount",
};
function summary(
  value: unknown,
  total: number,
  items: InventoryRow[],
  filters: InventoryFilters,
): InventorySummary {
  if (
    !object(value) ||
    value.productCount !== total ||
    bucketNames.some((key) => !integer(value[key]) || value[key] > total)
  )
    invalid();
  const counts = Object.fromEntries(
    bucketNames.map((key) => [key, value[key]]),
  ) as Omit<InventorySummary, "productCount">;
  if (
    counts.availableCount +
      counts.outOfStockCount +
      counts.missingInventoryCount !==
      total ||
    counts.lowStockCount > counts.availableCount ||
    counts.reservedCount > total - counts.missingInventoryCount
  )
    invalid();
  if (filters.stock && counts[stockBucket[filters.stock]] !== total) invalid();
  const visible = items.map((item) => buckets(item, filters.lowStockThreshold));
  if (
    bucketNames.some(
      (key) => visible.filter((entry) => entry[key]).length > counts[key],
    )
  )
    invalid();
  return { productCount: total, ...counts };
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
      new Error("Não foi possível consultar o estoque da loja."),
      status === undefined ? {} : { status },
      code === undefined ? {} : { code },
    );
  } finally {
    window.clearTimeout(timer);
    controller.signal.removeEventListener("abort", stop);
  }
}
export async function fetchInventory(
  filters: InventoryFilters,
  page: number,
  controller: AbortController,
): Promise<InventoryPage> {
  if (!integer(page, 1) || page > 1_000_000) invalidInput();
  const query = normalizedFilters(filters);
  const params = new URLSearchParams({
    page: String(page),
    pageSize: "20",
    lowStockThreshold: String(query.lowStockThreshold),
  });
  if (query.name) params.set("name", query.name);
  if (query.active !== undefined) params.set("active", query.active);
  if (query.stock) params.set("stock", query.stock);
  const value = await request(`/admin/inventory?${params}`, controller);
  if (
    !object(value) ||
    value.page !== page ||
    value.pageSize !== 20 ||
    value.lowStockThreshold !== query.lowStockThreshold ||
    !integer(value.total) ||
    !Array.isArray(value.items) ||
    value.items.length !==
      Math.min(20, Math.max(0, value.total - (page - 1) * 20))
  )
    invalid();
  const items = value.items.map(row);
  if (
    new Set(items.map((item) => item.id.toLowerCase())).size !== items.length ||
    items.some(
      (item) =>
        (query.active !== undefined &&
          item.active !== (query.active === "true")) ||
        (query.stock &&
          !buckets(item, query.lowStockThreshold)[stockBucket[query.stock]]),
    )
  )
    invalid();
  return {
    items,
    page,
    pageSize: 20,
    total: value.total,
    lowStockThreshold: query.lowStockThreshold,
    summary: summary(value.summary, value.total, items, query),
  };
}
export function inventoryError(error: unknown): string {
  const status =
    object(error) && integer(error.status) ? error.status : undefined;
  const code = object(error) ? error.code : undefined;
  if (status === 401)
    return "Sua sessão expirou. Entre novamente com uma conta de administrador.";
  if (status === 403)
    return "Acesso restrito a administradores. Entre com uma conta autorizada.";
  if (status === 400)
    return "Confira os filtros informados antes de consultar novamente.";
  if (status === 429)
    return "Muitas consultas. Aguarde um pouco antes de tentar novamente.";
  if (code === "TIMEOUT" || status === 408 || status === 504)
    return "A consulta demorou mais que o esperado. Tente novamente em instantes.";
  if (code === "INVALID_RESPONSE")
    return "Não foi possível conferir os dados do estoque. Atualize a consulta.";
  return "Não foi possível carregar o estoque da loja. Tente novamente em instantes.";
}
