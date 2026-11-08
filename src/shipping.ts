export interface AvailableItem {
  orderItemId: string;
  orderId: string;
  orderNumber: number;
  paidAt: string;
  productId: string | null;
  cardName: string;
  cardNumber: string;
  setName: string;
  conditionName: string;
  languageName: string;
  categoryName: string | null;
  purchasedQuantity: number;
  allocatedQuantity: number;
  availableQuantity: number;
  unitPrice: string;
  availableSubtotal: string;
}

export interface AvailablePage {
  items: AvailableItem[];
  page: number;
  pageSize: number;
  total: number;
  summary: { availableQuantity: number; availableValue: string };
}

export interface ShippingPackage {
  name: "Pequena" | "Média";
  height: number;
  width: number;
  length: number;
  weight: number;
}

export interface Shipment {
  id: string;
  status:
    | "ACCUMULATING"
    | "PENDING"
    | "PREPARING"
    | "READY_TO_SHIP"
    | "SHIPPED"
    | "DELIVERED"
    | "CANCELLED";
  shippingMethod: string;
  shippingCost: string | null;
  address: {
    addressId: string;
    recipientName: string;
    zipCode: string;
    street: string;
    number: string;
    complement: string | null;
    neighborhood: string;
    city: string;
    state: string;
  };
  trackingCode: string | null;
  selectedQuoteId: string | null;
  shippingPaidAt: string | null;
  packedAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  quote: {
    id: string;
    provider: string;
    serviceName: string;
    carrier: string;
    amount: string;
    deliveryDays: number;
    expiresAt: string;
    package: ShippingPackage & {
      originZipCode: string;
      destinationZipCode: string;
      declaredValue: string;
    };
  } | null;
  createdAt: string;
  updatedAt: string;
  items: Array<{
    orderItemId: string;
    orderId: string;
    quantity: number;
    cardName: string;
    cardNumber: string;
    setName: string;
    conditionName: string;
    languageName: string;
    unitPrice: string;
    subtotal: string;
  }>;
}

export interface ShipmentsPage {
  items: Shipment[];
  page: number;
  pageSize: number;
  total: number;
}

export interface QuoteBatch {
  shipmentId: string;
  package: ShippingPackage;
  expiresAt: string;
  options: Array<{
    id: string;
    provider: string;
    serviceCode: string;
    serviceName: string;
    carrier: string;
    amount: string;
    deliveryDays: number;
    expiresAt: string;
  }>;
  providers: Array<{
    provider: "melhorenvio" | "superfrete" | "frenet";
    status:
      "OK" | "NOT_CONFIGURED" | "TIMEOUT" | "INVALID_RESPONSE" | "UNAVAILABLE";
  }>;
}

export interface QuoteSelection {
  shipmentId: string;
  quoteId: string;
  provider: string;
  serviceName: string;
  carrier: string;
  shippingCost: string;
  deliveryDays: number;
  expiresAt: string;
}

export interface ShipmentInput {
  addressId: string;
  items: Array<{ orderItemId: string; quantity: number }>;
}

export interface ShipmentAttempt {
  key: string;
  input: ShipmentInput;
}

const prefix = "jornada-shipment-attempt:";
const uuidV4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactFields(value: Record<string, unknown>, keys: string[]) {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => key in value)
  );
}

function validUuid(value: unknown): value is string {
  return typeof value === "string" && uuidV4.test(value);
}

function normalizeInput(value: unknown): ShipmentInput {
  const invalid = () =>
    new Error(
      "Revise o endereço e selecione de 1 a 70 cartas para este envio.",
    );
  if (
    !record(value) ||
    !exactFields(value, ["addressId", "items"]) ||
    !validUuid(value.addressId) ||
    !Array.isArray(value.items) ||
    value.items.length < 1 ||
    value.items.length > 100
  )
    throw invalid();

  const items = value.items
    .map((item: unknown) => {
      if (
        !record(item) ||
        !exactFields(item, ["orderItemId", "quantity"]) ||
        !validUuid(item.orderItemId) ||
        typeof item.quantity !== "number" ||
        !Number.isSafeInteger(item.quantity) ||
        item.quantity < 1 ||
        item.quantity > 70
      )
        throw invalid();
      return {
        orderItemId: item.orderItemId.toLowerCase(),
        quantity: item.quantity,
      };
    })
    .sort((a, b) => a.orderItemId.localeCompare(b.orderItemId));
  if (
    new Set(items.map((item) => item.orderItemId)).size !== items.length ||
    items.reduce((sum, item) => sum + item.quantity, 0) > 70
  )
    throw invalid();
  return { addressId: value.addressId.toLowerCase(), items };
}

function storageError() {
  return new Error(
    "Não foi possível guardar a solicitação de envio. Permita o armazenamento desta aba antes de continuar.",
  );
}

function attemptKey(userId: string) {
  if (typeof userId !== "string" || !userId.trim())
    throw new Error("Entre na sua conta para continuar.");
  return `${prefix}${encodeURIComponent(userId)}`;
}

function storage(): Storage {
  try {
    const value = globalThis.sessionStorage;
    if (!value) throw storageError();
    return value;
  } catch {
    throw storageError();
  }
}

export function loadShipmentAttempt(userId: string): ShipmentAttempt | null {
  const key = attemptKey(userId);
  let raw: string | null;
  try {
    raw = storage().getItem(key);
  } catch {
    throw storageError();
  }
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !record(value) ||
      !exactFields(value, ["key", "input"]) ||
      !validUuid(value.key)
    )
      throw new Error();
    return { key: value.key.toLowerCase(), input: normalizeInput(value.input) };
  } catch {
    throw new Error(
      "Não foi possível recuperar a solicitação anterior. Consulte seus envios antes de tentar novamente.",
    );
  }
}

export function ensureShipmentAttempt(
  userId: string,
  input: ShipmentInput,
): ShipmentAttempt {
  // The original body must remain immutable after an ambiguous response,
  // even if the customer has changed the current selection or address.
  const existing = loadShipmentAttempt(userId);
  if (existing) return existing;
  const normalized = normalizeInput(input);
  let key: string;
  try {
    key = globalThis.crypto.randomUUID();
    if (!validUuid(key)) throw new Error();
  } catch {
    throw new Error(
      "Não foi possível preparar este envio. Atualize a página e tente novamente.",
    );
  }
  const attempt = { key: key.toLowerCase(), input: normalized };
  const raw = JSON.stringify(attempt);
  try {
    const target = storage();
    target.setItem(attemptKey(userId), raw);
    // Do not let the caller send a request until recovery data is readable.
    if (target.getItem(attemptKey(userId)) !== raw) throw storageError();
  } catch {
    throw storageError();
  }
  return attempt;
}

export function forgetShipmentAttempt(
  userId: string,
  expectedKey: string,
): void {
  try {
    // A late response must never clear a newer request for this account.
    if (loadShipmentAttempt(userId)?.key === expectedKey)
      storage().removeItem(attemptKey(userId));
  } catch {
    // Keeping a completed attempt is safe: replay returns the same shipment.
  }
}
