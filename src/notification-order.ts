import { authorized } from "./session";
import type { Order } from "./purchase";

const states = new Set([
  "PENDING_PAYMENT",
  "PAID",
  "PREPARING",
  "READY_TO_SHIP",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
]);
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
const amount = (value: unknown) =>
  typeof value === "string" && /^(0|[1-9]\d{0,9})\.\d{2}$/.test(value);
const date = (value: unknown) =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

function validOrder(value: unknown, id: string): value is Order {
  return (
    record(value) &&
    value.id === id &&
    Number.isSafeInteger(value.orderNumber) &&
    Number(value.orderNumber) > 0 &&
    typeof value.status === "string" &&
    states.has(value.status) &&
    ["subtotal", "shippingAmount", "discountAmount", "total"].every((key) =>
      amount(value[key]),
    ) &&
    ["createdAt", "updatedAt"].every((key) => date(value[key])) &&
    ["paidAt", "expiresAt", "cancelledAt"].every(
      (key) => value[key] === null || date(value[key]),
    ) &&
    Array.isArray(value.items) &&
    value.items.length > 0 &&
    value.items.every(
      (item) =>
        record(item) &&
        typeof item.id === "string" &&
        [
          "cardName",
          "cardNumber",
          "setName",
          "conditionName",
          "languageName",
        ].every((key) => typeof item[key] === "string") &&
        Number.isSafeInteger(item.quantity) &&
        Number(item.quantity) > 0 &&
        amount(item.unitPrice) &&
        amount(item.totalPrice),
    )
  );
}

/** Read an existing order only; opening a notification must never create a purchase. */
export async function loadNotificationOrder(
  id: string,
  controller: AbortController,
): Promise<Order> {
  if (controller.signal.aborted) throw new Error("Consulta interrompida.");
  const interrupted = new Promise<never>((_, reject) =>
    controller.signal.addEventListener(
      "abort",
      () => reject(new Error("Consulta interrompida.")),
      { once: true },
    ),
  );
  const timer = window.setTimeout(() => controller.abort(), 15000);
  try {
    const result = await Promise.race([
      authorized<unknown>(`/orders/${encodeURIComponent(id)}`, {
        method: "GET",
        signal: controller.signal,
        cache: "no-store",
      }),
      interrupted,
    ]);
    if (!validOrder(result, id))
      throw new Error("Resposta de pedido inválida.");
    return result;
  } finally {
    window.clearTimeout(timer);
  }
}
