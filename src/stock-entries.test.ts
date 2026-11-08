// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authorized } from "./session";
import {
  clearPendingEntry,
  createEntryKey,
  fetchStockEntry,
  readPendingEntry,
  savePendingEntry,
  stockEntryError,
  submitStockEntry,
  validateStockEntry,
} from "./stock-entries";
import type { PendingStockEntry } from "./stock-entries";
import type { StockMovement } from "./stock-movements";

vi.mock("./session", () => ({ authorized: vi.fn() }));
const id = (number: number) =>
  `${number.toString(16).padStart(8, "0")}-abcd-4abc-8abc-111111111111`;
const user = id(1);
const product = id(2);
const key = id(3);
const storageKey = `jornada-stock-entry:${user}:${product}`;
const attempt: PendingStockEntry = {
  key,
  quantity: 3,
  reason: "Conferência de entrada",
};
const controller = () => new AbortController();
function receipt(): StockMovement {
  return {
    id: id(4),
    sequence: "9007199254740993",
    type: "STOCK_RECEIPT",
    createdAt: "2026-11-07T12:00:00.000Z",
    product: {
      id: product,
      cardName: "Pikachu de demonstração",
      cardNumber: "025",
      setName: "Coleção original",
      categoryName: "Cartas avulsas",
      conditionName: "Near Mint",
      languageName: "Português",
    },
    actor: { id: user, name: "Gestor de demonstração" },
    order: null,
    reason: attempt.reason,
    before: { availableQuantity: 5, reservedQuantity: 2, soldQuantity: 10 },
    change: { availableQuantity: 3, reservedQuantity: 0, soldQuantity: 0 },
    after: { availableQuantity: 8, reservedQuantity: 2, soldQuantity: 10 },
  };
}
beforeEach(() => {
  sessionStorage.clear();
  vi.mocked(authorized).mockReset();
  vi.mocked(authorized).mockResolvedValue(receipt());
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Validação de entrada", () => {
  it("normaliza quantidade e motivo sem modificar os dados revisados", () => {
    const draft = { quantity: " 3 ", reason: "  Conferência de entrada  " };
    expect(validateStockEntry(draft)).toEqual({
      input: { quantity: 3, reason: attempt.reason },
      errors: {},
    });
    expect(draft.reason).toBe("  Conferência de entrada  ");
  });
  it("aceita limites inteiros do estoque", () => {
    for (const quantity of ["1", "2147483647"])
      expect(
        validateStockEntry({ quantity, reason: "Entrada" }).input?.quantity,
      ).toBe(Number(quantity));
  });
  it.each(["", "0", "-1", "01", "1.5", "1e2", "2,0", "2147483648", "NaN"])(
    "recusa quantidade %s",
    (quantity) => {
      const result = validateStockEntry({ quantity, reason: "Entrada" });
      expect(result.input).toBeUndefined();
      expect(result.errors.quantity).toBeTruthy();
    },
  );
  it.each([
    "",
    "  ",
    "ab",
    "x".repeat(501),
    "Entrada\nextra",
    "Entrada\u0000oculta",
  ])("recusa motivo inválido %#", (reason) => {
    const result = validateStockEntry({ quantity: "3", reason });
    expect(result.input).toBeUndefined();
    expect(result.errors.reason).toBeTruthy();
  });
  it("não converte tipos de entrada inesperados", () => {
    const result = validateStockEntry({ quantity: 3, reason: null } as never);
    expect(result.errors.quantity).toBeTruthy();
    expect(result.errors.reason).toBeTruthy();
  });
});

describe("Tentativa persistida por usuário e produto", () => {
  it("grava e lê a tentativa original com identificadores canônicos", () => {
    savePendingEntry(user.toUpperCase(), product.toUpperCase(), {
      ...attempt,
      key: key.toUpperCase(),
    });
    expect(JSON.parse(sessionStorage.getItem(storageKey)!)).toEqual(attempt);
    expect(readPendingEntry(user, product)).toEqual({
      pending: attempt,
      blocked: false,
    });
    expect(readPendingEntry(id(5), product)).toEqual({
      pending: null,
      blocked: false,
    });
    expect(readPendingEntry(user, id(6))).toEqual({
      pending: null,
      blocked: false,
    });
  });
  it("permite salvar novamente os mesmos dados sem trocar a chave", () => {
    savePendingEntry(user, product, attempt);
    savePendingEntry(user, product, { ...attempt });
    expect(readPendingEntry(user, product).pending).toEqual(attempt);
  });
  it.each([{ key: id(7) }, { quantity: 4 }, { reason: "Outra entrada" }])(
    "não substitui tentativa não concluída %#",
    (change) => {
      savePendingEntry(user, product, attempt);
      expect(() =>
        savePendingEntry(user, product, { ...attempt, ...change }),
      ).toThrow();
      expect(readPendingEntry(user, product).pending).toEqual(attempt);
    },
  );
  it.each([
    "{",
    "null",
    "[]",
    JSON.stringify({ ...attempt, extra: true }),
    JSON.stringify({ ...attempt, quantity: "3" }),
    JSON.stringify({ ...attempt, reason: " Entrada " }),
    JSON.stringify({ ...attempt, key: "bad" }),
  ])("bloqueia armazenamento corrompido sem apagá-lo %#", (raw) => {
    sessionStorage.setItem(storageKey, raw);
    expect(readPendingEntry(user, product)).toEqual({
      pending: null,
      blocked: true,
    });
    expect(() => savePendingEntry(user, product, attempt)).toThrow();
    expect(() => clearPendingEntry(user, product, key)).toThrow();
    expect(sessionStorage.getItem(storageKey)).toBe(raw);
  });
  it("bloqueia usuário ou produto inválidos sem acessar armazenamento", () => {
    const get = vi.spyOn(Storage.prototype, "getItem");
    expect(readPendingEntry(" ", product).blocked).toBe(true);
    expect(readPendingEntry(user, "01").blocked).toBe(true);
    expect(() => savePendingEntry(user, "01", attempt)).toThrow();
    expect(get).not.toHaveBeenCalled();
  });
  it("não libera o cadastro quando o navegador nega a leitura", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("PRIVATE_STORAGE_ERROR");
    });
    expect(readPendingEntry(user, product)).toEqual({
      pending: null,
      blocked: true,
    });
    expect(() => savePendingEntry(user, product, attempt)).toThrow(
      "Não foi possível proteger",
    );
  });
  it("propaga falha de escrita com mensagem fixa", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("PRIVATE_QUOTA");
    });
    try {
      savePendingEntry(user, product, attempt);
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toMatchObject({ code: "STORAGE_ERROR" });
      expect(String(error)).not.toContain("PRIVATE_QUOTA");
    }
  });
  it("confere a leitura após persistir antes de permitir envio", () => {
    vi.spyOn(Storage.prototype, "getItem").mockReturnValue(null);
    expect(() => savePendingEntry(user, product, attempt)).toThrow();
    expect(authorized).not.toHaveBeenCalled();
  });
  it("limpa somente a chave conferida e confirma sua remoção", () => {
    savePendingEntry(user, product, attempt);
    clearPendingEntry(user, product, key.toUpperCase());
    expect(readPendingEntry(user, product)).toEqual({
      pending: null,
      blocked: false,
    });
    expect(() => clearPendingEntry(user, product, key)).not.toThrow();
  });
  it("não apaga tentativa de outra chave", () => {
    savePendingEntry(user, product, attempt);
    const remove = vi.spyOn(Storage.prototype, "removeItem");
    expect(() => clearPendingEntry(user, product, id(8))).toThrow();
    expect(remove).not.toHaveBeenCalled();
    expect(readPendingEntry(user, product).pending).toEqual(attempt);
  });
  it("não libera nova entrada quando a remoção falha silenciosamente", () => {
    savePendingEntry(user, product, attempt);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {});
    expect(() => clearPendingEntry(user, product, key)).toThrow();
    expect(readPendingEntry(user, product).pending).toEqual(attempt);
  });
  it("gera UUID criptográfico sem gravar ou enviar", () => {
    const random = vi
      .spyOn(crypto, "randomUUID")
      .mockReturnValue(key as ReturnType<Crypto["randomUUID"]>);
    const set = vi.spyOn(Storage.prototype, "setItem");
    expect(createEntryKey()).toBe(key);
    expect(random).toHaveBeenCalledOnce();
    expect(set).not.toHaveBeenCalled();
    expect(authorized).not.toHaveBeenCalled();
  });
  it("recusa geração indisponível ou inválida em vez de inventar uma chave", () => {
    vi.spyOn(crypto, "randomUUID").mockImplementation(() => {
      throw new Error("PRIVATE_RANDOM");
    });
    expect(() => createEntryKey()).toThrow("Não foi possível proteger");
  });
});

describe("Consultas e confirmação de entrada", () => {
  it("envia somente quantidade e motivo com a chave revisada no header", async () => {
    const abort = controller();
    const result = await submitStockEntry(product, attempt, abort);
    expect(result).toEqual(receipt());
    expect(authorized).toHaveBeenCalledExactlyOnceWith(
      `/products/${product}/inventory/entries`,
      {
        method: "POST",
        cache: "no-store",
        signal: abort.signal,
        headers: { "Idempotency-Key": key },
        body: JSON.stringify({ quantity: 3, reason: attempt.reason }),
      },
    );
  });
  it("o reenvio explícito preserva exatamente chave e corpo", async () => {
    await submitStockEntry(product, attempt, controller());
    await submitStockEntry(product, attempt, controller());
    const calls = vi.mocked(authorized).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1][1]?.headers).toEqual(calls[0][1]?.headers);
    expect(calls[1][1]?.body).toBe(calls[0][1]?.body);
  });
  it("verifica recibo por GET sem body, POST ou alteração da tentativa salva", async () => {
    savePendingEntry(user, product, attempt);
    const abort = controller();
    await fetchStockEntry(product, key.toUpperCase(), abort);
    expect(authorized).toHaveBeenCalledExactlyOnceWith(
      `/products/${product}/inventory/entries/${key}`,
      { method: "GET", cache: "no-store", signal: abort.signal },
    );
    expect(readPendingEntry(user, product).pending).toEqual(attempt);
  });
  it("404 não apaga a tentativa e não inicia nova escrita", async () => {
    savePendingEntry(user, product, attempt);
    vi.mocked(authorized).mockRejectedValue(
      Object.assign(new Error("PRIVATE_NOT_FOUND"), { status: 404 }),
    );
    await expect(
      fetchStockEntry(product, key, controller()),
    ).rejects.toMatchObject({ status: 404 });
    expect(readPendingEntry(user, product).pending).toEqual(attempt);
    expect(authorized).toHaveBeenCalledTimes(1);
  });
  it("normaliza recibo removendo propriedades internas", async () => {
    vi.mocked(authorized).mockResolvedValue({
      ...receipt(),
      operationKey: key,
      raw: "PRIVATE",
      product: { ...receipt().product, secret: "PRIVATE" },
      actor: { ...receipt().actor, email: "private@example.com" },
    });
    const result = await submitStockEntry(product, attempt, controller());
    expect(result).toEqual(receipt());
    expect(result.sequence).toBe("9007199254740993");
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
    expect(JSON.stringify(result)).not.toContain("private@example.com");
  });
  it("aceita recibo histórico mesmo que o saldo posterior já tenha mudado", async () => {
    const result = await fetchStockEntry(
      product.toUpperCase(),
      key,
      controller(),
    );
    expect(result.after.availableQuantity).toBe(8);
    expect(result.before.reservedQuantity).toBe(2);
    expect(result.after.soldQuantity).toBe(10);
    expect(authorized).toHaveBeenCalledTimes(1);
  });
  it.each([
    { type: "MANUAL_ADJUSTMENT" },
    { product: { ...receipt().product, id: id(8) } },
    { reason: "Outro motivo" },
    {
      change: { availableQuantity: 2, reservedQuantity: 0, soldQuantity: 0 },
      after: { availableQuantity: 7, reservedQuantity: 2, soldQuantity: 10 },
    },
    {
      change: { availableQuantity: 3, reservedQuantity: 1, soldQuantity: 0 },
      after: { availableQuantity: 8, reservedQuantity: 3, soldQuantity: 10 },
    },
    { order: { id: id(6), orderNumber: 18 } },
    { after: { availableQuantity: 7, reservedQuantity: 2, soldQuantity: 10 } },
  ])("recusa recibo incompatível com a tentativa %#", async (change) => {
    vi.mocked(authorized).mockResolvedValue({ ...receipt(), ...change });
    await expect(
      submitStockEntry(product, attempt, controller()),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("não aceita produto, chave ou quantidade inválidos antes de enviar", async () => {
    await expect(
      submitStockEntry("01", attempt, controller()),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      submitStockEntry(product, { ...attempt, quantity: 0 }, controller()),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      fetchStockEntry(product, "01", controller()),
    ).rejects.toMatchObject({ status: 400 });
    expect(authorized).not.toHaveBeenCalled();
  });
  it("não envia com um sinal já interrompido", async () => {
    const abort = controller();
    abort.abort();
    await expect(
      submitStockEntry(product, attempt, abort),
    ).rejects.toMatchObject({ code: "ABORTED" });
    expect(authorized).not.toHaveBeenCalled();
  });
  it("interrompe transporte que ignora abort e limpa timer e listener", async () => {
    vi.useFakeTimers();
    let resolve!: (value: StockMovement) => void;
    vi.mocked(authorized).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const abort = controller(),
      remove = vi.spyOn(abort.signal, "removeEventListener");
    const promise = submitStockEntry(product, attempt, abort);
    const rejected = expect(promise).rejects.toMatchObject({ code: "ABORTED" });
    abort.abort();
    await rejected;
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
    resolve(receipt());
    await Promise.resolve();
    expect(authorized).toHaveBeenCalledTimes(1);
  });
  it("aplica prazo de quinze segundos sem repetir ou apagar tentativa", async () => {
    vi.useFakeTimers();
    savePendingEntry(user, product, attempt);
    vi.mocked(authorized).mockReturnValue(new Promise(() => {}));
    const abort = controller(),
      promise = submitStockEntry(product, attempt, abort);
    const rejected = expect(promise).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(15_000);
    await rejected;
    expect(abort.signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(authorized).toHaveBeenCalledTimes(1);
    expect(readPendingEntry(user, product).pending).toEqual(attempt);
  });
  it("limpa o prazo e listener após sucesso", async () => {
    vi.useFakeTimers();
    const abort = controller(),
      remove = vi.spyOn(abort.signal, "removeEventListener");
    await submitStockEntry(product, attempt, abort);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([401, 403, 409, 429, 503])(
    "preserva somente status útil ao tratar erro %s",
    async (status) => {
      vi.mocked(authorized).mockRejectedValue(
        Object.assign(new Error("PRIVATE_DATABASE_SECRET"), {
          status,
          detail: "PRIVATE",
          code: "PG_SECRET",
        }),
      );
      const caught = await submitStockEntry(
        product,
        attempt,
        controller(),
      ).catch((error: unknown) => error);
      expect(caught).toMatchObject({ status });
      expect(String(caught)).not.toContain("PRIVATE");
      expect(JSON.stringify(caught)).not.toContain("PRIVATE");
      expect(JSON.stringify(caught)).not.toContain("PG_SECRET");
      expect(authorized).toHaveBeenCalledTimes(1);
    },
  );
});

describe("Mensagens de falha", () => {
  it.each([
    [{ code: "STORAGE_ERROR" }, "proteger"],
    [{ status: 400 }, "quantidade"],
    [{ status: 401 }, "sessão expirou"],
    [{ status: 403 }, "administradores"],
    [{ status: 404 }, "não encontrada"],
    [{ status: 409 }, "conferência"],
    [{ status: 429 }, "Muitas solicitações"],
    [{ code: "TIMEOUT" }, "demorou"],
    [{ code: "INVALID_RESPONSE" }, "conferir"],
    [new Error("PRIVATE_PROVIDER_SECRET"), "pode ter sido registrada"],
  ])("explica erro sem incluir conteúdo externo %#", (error, expected) => {
    const message = stockEntryError(error);
    expect(message).toContain(expected);
    expect(message).not.toContain("PRIVATE_PROVIDER_SECRET");
  });
});
