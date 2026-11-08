export interface Order {
  id: string;
  orderNumber: number;
  status:
    | "PENDING_PAYMENT"
    | "PAID"
    | "PREPARING"
    | "READY_TO_SHIP"
    | "SHIPPED"
    | "DELIVERED"
    | "CANCELLED";
  subtotal: string;
  shippingAmount: string;
  discountAmount: string;
  total: string;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  expiresAt: string | null;
  cancelledAt: string | null;
  items: Array<{
    id: string;
    productId: string | null;
    cardName: string;
    cardNumber: string;
    setName: string;
    conditionName: string;
    languageName: string;
    categoryName: string;
    quantity: number;
    unitPrice: string;
    totalPrice: string;
  }>;
}

export interface OrdersPage {
  items: Order[];
  page: number;
  pageSize: number;
  total: number;
}

export interface PixResult {
  payment: {
    id: string;
    orderId: string | null;
    shipmentId: string | null;
    provider: string;
    method: "PIX" | "CREDIT_CARD" | "DEBIT_CARD" | "BOLETO";
    status:
      "PENDING" | "PAID" | "FAILED" | "EXPIRED" | "REFUNDED" | "CANCELLED";
    amount: string;
    installments: number;
    createdAt: string;
    updatedAt: string;
    paidAt: string | null;
    failedAt: string | null;
    expiresAt: string | null;
  };
  pix: {
    encodedImage: string;
    payload: string;
    expirationDate: string;
  } | null;
  reservationExpiresAt: string | null;
}

export interface CheckoutAttempt {
  key: string;
  expectedSubtotal: string;
}

const prefix = "jornada-checkout-attempt:";
const uuidV4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const positiveAmount = (value: unknown): value is string =>
  typeof value === "string" &&
  /^(0|[1-9]\d{0,9})\.\d{2}$/.test(value) &&
  value !== "0.00";

function storageError() {
  return new Error(
    "Não foi possível guardar a confirmação desta compra. Permita o armazenamento desta aba antes de continuar.",
  );
}

function attemptKey(userId: string) {
  if (!userId.trim()) throw new Error("Entre na sua conta para continuar.");
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

export function loadAttempt(userId: string): CheckoutAttempt | null {
  const key = attemptKey(userId);
  let raw: string | null;
  try {
    raw = storage().getItem(key);
  } catch {
    throw storageError();
  }
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      Object.keys(parsed).length !== 2 ||
      !("key" in parsed) ||
      typeof parsed.key !== "string" ||
      !uuidV4.test(parsed.key) ||
      !("expectedSubtotal" in parsed) ||
      !positiveAmount(parsed.expectedSubtotal)
    ) {
      throw new Error();
    }
    return { key: parsed.key, expectedSubtotal: parsed.expectedSubtotal };
  } catch {
    throw new Error(
      "Não foi possível recuperar a confirmação anterior. Consulte seus pedidos antes de tentar novamente.",
    );
  }
}

export function ensureAttempt(
  userId: string,
  expectedSubtotal: string,
): CheckoutAttempt {
  // Recover the original request before considering a changed cart total.
  const existing = loadAttempt(userId);
  if (existing) return existing;
  if (!positiveAmount(expectedSubtotal)) {
    throw new Error("Revise o total do carrinho antes de continuar.");
  }
  let key: string;
  try {
    key = globalThis.crypto.randomUUID();
    if (!uuidV4.test(key)) throw new Error();
  } catch {
    throw new Error(
      "Não foi possível preparar esta compra. Atualize a página e tente novamente.",
    );
  }
  const attempt = { key, expectedSubtotal };
  try {
    storage().setItem(attemptKey(userId), JSON.stringify(attempt));
  } catch {
    throw storageError();
  }
  return attempt;
}

export function forgetAttempt(userId: string, expectedKey: string): void {
  try {
    // A late response from an older view must not clear a newer purchase.
    if (loadAttempt(userId)?.key === expectedKey) {
      storage().removeItem(attemptKey(userId));
    }
  } catch {
    // Keeping an already completed attempt is safe: replay returns its order.
  }
}
