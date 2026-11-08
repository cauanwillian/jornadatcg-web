import { authorized } from "./session";
import { parseStockMovement } from "./stock-movements";
import type { StockMovement } from "./stock-movements";

export interface StockEntryInput {
  quantity: number;
  reason: string;
}
export interface StockEntryDraft {
  quantity: string;
  reason: string;
}
export interface PendingStockEntry extends StockEntryInput {
  key: string;
}
type EntryErrors = Partial<Record<keyof StockEntryDraft, string>>;
const maximumQuantity = 2_147_483_647;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
const validId = (value: unknown): value is string =>
  typeof value === "string" && uuid.test(value);
const validQuantity = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value > 0 &&
  value <= maximumQuantity;
const controls = (value: string) =>
  Array.from(value).some(
    (character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
  );
const validReason = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= 500 &&
  value.trim().length >= 3 &&
  !controls(value);
const sameId = (first: string, second: string) =>
  first.toLowerCase() === second.toLowerCase();
const storageFailure = () =>
  Object.assign(
    new Error(
      "Não foi possível proteger a tentativa de entrada neste navegador.",
    ),
    { code: "STORAGE_ERROR" },
  );
function invalidInput(): never {
  throw Object.assign(new Error("Dados da entrada de estoque inválidos."), {
    status: 400,
  });
}
function invalidResponse(): never {
  throw Object.assign(new Error("Resposta de entrada de estoque inválida."), {
    code: "INVALID_RESPONSE",
  });
}

export function validateStockEntry(draft: StockEntryDraft): {
  input?: StockEntryInput;
  errors: EntryErrors;
} {
  const errors: EntryErrors = {};
  const quantity =
    typeof draft?.quantity === "string" ? draft.quantity.trim() : "";
  if (!/^[1-9]\d*$/.test(quantity) || !validQuantity(Number(quantity)))
    errors.quantity = "Informe uma quantidade inteira entre 1 e 2.147.483.647.";
  if (!validReason(draft?.reason))
    errors.reason = "Informe um motivo entre 3 e 500 caracteres válidos.";
  return Object.keys(errors).length
    ? { errors }
    : {
        input: { quantity: Number(quantity), reason: draft.reason.trim() },
        errors,
      };
}
function pending(value: unknown): PendingStockEntry {
  if (
    !object(value) ||
    Object.keys(value).length !== 3 ||
    Object.keys(value).some(
      (key) => !["key", "quantity", "reason"].includes(key),
    ) ||
    !validId(value.key) ||
    !validQuantity(value.quantity) ||
    !validReason(value.reason) ||
    value.reason !== value.reason.trim()
  )
    throw storageFailure();
  return {
    key: value.key.toLowerCase(),
    quantity: value.quantity,
    reason: value.reason,
  };
}
function keyFor(userId: string, productId: string) {
  if (
    typeof userId !== "string" ||
    !userId ||
    userId !== userId.trim() ||
    userId.length > 200 ||
    controls(userId) ||
    !validId(productId)
  )
    throw storageFailure();
  return `jornada-stock-entry:${validId(userId) ? userId.toLowerCase() : userId}:${productId.toLowerCase()}`;
}
function parsePending(raw: string): PendingStockEntry {
  try {
    return pending(JSON.parse(raw));
  } catch {
    throw storageFailure();
  }
}
const sameAttempt = (first: PendingStockEntry, second: PendingStockEntry) =>
  sameId(first.key, second.key) &&
  first.quantity === second.quantity &&
  first.reason === second.reason;

export function readPendingEntry(
  userId: string,
  productId: string,
): { pending: PendingStockEntry | null; blocked: boolean } {
  try {
    const raw = sessionStorage.getItem(keyFor(userId, productId));
    return { pending: raw === null ? null : parsePending(raw), blocked: false };
  } catch {
    return { pending: null, blocked: true };
  }
}
export function savePendingEntry(
  userId: string,
  productId: string,
  attempt: PendingStockEntry,
): void {
  try {
    const storageKey = keyFor(userId, productId),
      entry = pending(attempt);
    const existing = sessionStorage.getItem(storageKey);
    if (existing !== null && !sameAttempt(parsePending(existing), entry))
      throw storageFailure();
    const raw = JSON.stringify(entry);
    sessionStorage.setItem(storageKey, raw);
    if (sessionStorage.getItem(storageKey) !== raw) throw storageFailure();
  } catch {
    throw storageFailure();
  }
}
export function clearPendingEntry(
  userId: string,
  productId: string,
  key: string,
): void {
  try {
    if (!validId(key)) throw storageFailure();
    const storageKey = keyFor(userId, productId),
      existing = sessionStorage.getItem(storageKey);
    if (existing === null) return;
    if (!sameId(parsePending(existing).key, key)) throw storageFailure();
    sessionStorage.removeItem(storageKey);
    if (sessionStorage.getItem(storageKey) !== null) throw storageFailure();
  } catch {
    throw storageFailure();
  }
}
export function createEntryKey(): string {
  try {
    const key = crypto.randomUUID();
    if (!validId(key)) throw storageFailure();
    return key.toLowerCase();
  } catch {
    throw storageFailure();
  }
}

async function request(
  path: string,
  controller: AbortController,
  attempt?: PendingStockEntry,
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
        Object.assign(new Error("Solicitação interrompida."), {
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
        method: attempt ? "POST" : "GET",
        cache: "no-store",
        signal: controller.signal,
        ...(attempt
          ? {
              headers: { "Idempotency-Key": attempt.key },
              body: JSON.stringify({
                quantity: attempt.quantity,
                reason: attempt.reason,
              }),
            }
          : {}),
      }),
      interrupted,
    ]);
  } catch (caught) {
    const status =
      object(caught) &&
      typeof caught.status === "number" &&
      Number.isInteger(caught.status) &&
      caught.status >= 100 &&
      caught.status <= 599
        ? caught.status
        : undefined;
    const code =
      object(caught) && (caught.code === "TIMEOUT" || caught.code === "ABORTED")
        ? caught.code
        : undefined;
    throw Object.assign(
      new Error("Não foi possível confirmar a entrada de estoque."),
      status === undefined ? {} : { status },
      code === undefined ? {} : { code },
    );
  } finally {
    window.clearTimeout(timer);
    controller.signal.removeEventListener("abort", stop);
  }
}
function receipt(value: unknown, productId: string): StockMovement {
  const movement = parseStockMovement(value);
  if (
    movement.type !== "STOCK_RECEIPT" ||
    !sameId(movement.product.id, productId) ||
    movement.order !== null ||
    !validQuantity(movement.change.availableQuantity) ||
    movement.change.reservedQuantity !== 0 ||
    movement.change.soldQuantity !== 0 ||
    !validReason(movement.reason) ||
    movement.reason !== movement.reason.trim()
  )
    invalidResponse();
  return movement;
}
export async function submitStockEntry(
  productId: string,
  attempt: PendingStockEntry,
  controller: AbortController,
): Promise<StockMovement> {
  if (!validId(productId)) invalidInput();
  let input: PendingStockEntry;
  try {
    input = pending(attempt);
  } catch {
    invalidInput();
  }
  const result = receipt(
    await request(
      `/products/${productId}/inventory/entries`,
      controller,
      input,
    ),
    productId,
  );
  if (
    result.change.availableQuantity !== input.quantity ||
    result.reason !== input.reason
  )
    invalidResponse();
  return result;
}
export async function fetchStockEntry(
  productId: string,
  key: string,
  controller: AbortController,
): Promise<StockMovement> {
  if (!validId(productId) || !validId(key)) invalidInput();
  return receipt(
    await request(
      `/products/${productId}/inventory/entries/${key.toLowerCase()}`,
      controller,
    ),
    productId,
  );
}
export function stockEntryError(error: unknown): string {
  const status = object(error) ? error.status : undefined;
  const code = object(error) ? error.code : undefined;
  if (code === "STORAGE_ERROR")
    return "Não foi possível proteger esta tentativa no navegador. Confira o histórico antes de continuar.";
  if (status === 400) return "Confira a quantidade e o motivo da entrada.";
  if (status === 401)
    return "Sua sessão expirou. Entre novamente para conferir a entrada.";
  if (status === 403) return "Acesso restrito a administradores.";
  if (status === 404)
    return "Entrada não encontrada. Confira o produto e a tentativa pendente.";
  if (status === 409)
    return "A entrada exige conferência. Verifique a tentativa e o estoque atualizado antes de continuar.";
  if (status === 429)
    return "Muitas solicitações. Aguarde um pouco antes de tentar novamente.";
  if (code === "TIMEOUT" || status === 408 || status === 504)
    return "A confirmação demorou mais que o esperado. Verifique a entrada antes de reenviar a mesma tentativa.";
  if (code === "INVALID_RESPONSE")
    return "Não foi possível conferir a confirmação. Verifique a entrada antes de continuar.";
  return "Não foi possível confirmar a entrada. Ela pode ter sido registrada. Verifique a tentativa antes de reenviar.";
}
