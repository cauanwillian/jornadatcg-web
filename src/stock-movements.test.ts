// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authorized } from "./session";
import {
  fetchStockMovements,
  movementError,
  movementLabels,
  validateMovementFilters,
} from "./stock-movements";
import type {
  MovementFilterDraft,
  MovementFilters,
  StockMovement,
} from "./stock-movements";

vi.mock("./session", () => ({ authorized: vi.fn() }));
const id = (n: number) =>
  `${n.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`;
const date = "2026-11-06T12:00:00.000Z";
const blank: MovementFilterDraft = { type: "", from: "", to: "" };
function movement(): StockMovement {
  return {
    id: id(1),
    sequence: "9007199254740993",
    type: "ORDER_RESERVED",
    createdAt: date,
    product: {
      id: id(2),
      cardName: "Pikachu antigo",
      cardNumber: "025",
      setName: "Coleção original",
      categoryName: "Avulsas",
      conditionName: "Near Mint",
      languageName: "Português",
    },
    order: { id: id(3), orderNumber: 18 },
    actor: null,
    reason: null,
    before: { availableQuantity: 5, reservedQuantity: 0, soldQuantity: 2 },
    change: { availableQuantity: -2, reservedQuantity: 2, soldQuantity: 0 },
    after: { availableQuantity: 3, reservedQuantity: 2, soldQuantity: 2 },
  };
}
function page(
  items: unknown[] = [movement()],
  total = items.length,
  number = 1,
) {
  return { items, total, page: number, pageSize: 20 };
}
const read = (
  filters: MovementFilters = {},
  number = 1,
  controller = new AbortController(),
) => fetchStockMovements(filters, number, controller);
beforeEach(() => {
  vi.mocked(authorized).mockReset();
  vi.mocked(authorized).mockResolvedValue(page());
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe("filtros do histórico", () => {
  it("mantém filtros vazios opcionais", () => {
    expect(validateMovementFilters(blank)).toEqual({ query: {}, errors: {} });
  });
  it.each(Object.keys(movementLabels))("aceita tipo %s", (type) => {
    expect(validateMovementFilters({ ...blank, type }).query).toEqual({ type });
  });
  it("recusa tipos desconhecidos", () => {
    expect(
      validateMovementFilters({ ...blank, type: "REFUND" }).errors.type,
    ).toBeTruthy();
  });
  it.each(["2026-02-30", "2026-13-01", "2026-1-1", "01/01/2026", "invalid"])(
    "recusa dia inválido %s",
    (from) => {
      expect(
        validateMovementFilters({ ...blank, from }).errors.from,
      ).toBeTruthy();
    },
  );
  it("inclui o dia final até a meia-noite seguinte local", () => {
    const result = validateMovementFilters({
      ...blank,
      from: "2026-11-05",
      to: "2026-11-06",
    });
    expect(result.query).toEqual({
      from: new Date("2026-11-05T00:00:00").toISOString(),
      to: new Date("2026-11-07T00:00:00").toISOString(),
    });
  });
  it("aceita o mesmo dia inicial e final", () => {
    expect(
      validateMovementFilters({
        ...blank,
        from: "2026-11-06",
        to: "2026-11-06",
      }).query,
    ).toBeTruthy();
  });
  it("recusa intervalo invertido", () => {
    expect(
      validateMovementFilters({
        ...blank,
        from: "2026-11-07",
        to: "2026-11-06",
      }).errors.to,
    ).toBeTruthy();
  });
  it.each([
    ["America/Santiago", "2026-09-06", "2026-09-07"],
    ["America/Cuiaba", "2018-11-04", "2018-11-05"],
  ])("encerra corretamente após mudança de horário em %s", (zone, to, next) => {
    try {
      vi.stubEnv("TZ", zone);
      expect(validateMovementFilters({ ...blank, to }).query?.to).toBe(
        new Date(`${next}T00:00:00`).toISOString(),
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
describe("consulta e normalização do histórico", () => {
  it("usa apenas GET com filtro de produto e sem cache", async () => {
    await read({
      productId: id(2),
      type: "ORDER_RESERVED",
      from: "2026-11-06T00:00:00.000Z",
      to: "2026-11-07T00:00:00.000Z",
    });
    const [path, options] = vi.mocked(authorized).mock.calls[0];
    const url = new URL(path, "http://localhost");
    expect(url.pathname).toBe("/admin/inventory/movements");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      page: "1",
      pageSize: "20",
      productId: id(2),
      type: "ORDER_RESERVED",
      from: "2026-11-06T00:00:00.000Z",
      to: "2026-11-07T00:00:00.000Z",
    });
    expect(options).toMatchObject({ method: "GET", cache: "no-store" });
    expect(options?.body).toBeUndefined();
  });
  it("preserva sequência BigInt e todos os saldos de snapshot", async () => {
    const result = await read();
    expect(result.items[0]).toEqual(movement());
    expect(result.items[0].sequence).toBe("9007199254740993");
  });
  it("remove campos extras e dados pessoais desnecessários", async () => {
    const value = {
      ...movement(),
      metadata: { secret: "hidden" },
      actor: {
        id: id(4),
        name: "Administrador",
        email: "private@example.com",
        passwordHash: "hidden",
      },
      product: { ...movement().product, price: "10.00", metadata: "hidden" },
      order: {
        id: id(3),
        orderNumber: 18,
        customerEmail: "hidden@example.com",
      },
    };
    vi.mocked(authorized).mockResolvedValue(page([value]));
    const result = await read();
    expect(JSON.stringify(result)).not.toMatch(
      /hidden|private@example|passwordHash|metadata|price/,
    );
    expect(result.items[0].actor).toEqual({ id: id(4), name: "Administrador" });
  });
  it("preserva pedido removido com número histórico", async () => {
    const value = { ...movement(), order: { id: null, orderNumber: 18 } };
    vi.mocked(authorized).mockResolvedValue(page([value]));
    expect((await read()).items[0].order).toEqual(value.order);
  });
  it("aceita abertura sem pedido e sem ator com os três saldos", async () => {
    const value = {
      ...movement(),
      type: "OPENING_BALANCE",
      order: null,
      before: { availableQuantity: 0, reservedQuantity: 0, soldQuantity: 0 },
      change: movement().after,
    };
    vi.mocked(authorized).mockResolvedValue(page([value]));
    expect((await read()).items[0].type).toBe("OPENING_BALANCE");
  });
  it("aceita página vazia e total zero", async () => {
    vi.mocked(authorized).mockResolvedValue(page([]));
    expect(await read()).toEqual(page([]));
  });
  it("aceita página fora do intervalo após alteração do total", async () => {
    vi.mocked(authorized).mockResolvedValue(page([], 15, 2));
    expect((await read({}, 2)).total).toBe(15);
  });
  it("não limita total ao tamanho da página", async () => {
    const items = Array.from({ length: 20 }, (_, n) => ({
      ...movement(),
      id: id(n + 10),
      sequence: String(100 - n),
    }));
    vi.mocked(authorized).mockResolvedValue(page(items, 42));
    expect((await read()).total).toBe(42);
  });
  it.each([
    [
      "saldo negativo",
      (m: StockMovement) => {
        m.before.availableQuantity = -1;
      },
    ],
    [
      "delta incoerente",
      (m: StockMovement) => {
        m.change.availableQuantity = 2;
      },
    ],
    [
      "saldo fracionário",
      (m: StockMovement) => {
        m.after.soldQuantity = 2.5;
      },
    ],
    [
      "limite excedido",
      (m: StockMovement) => {
        m.after.soldQuantity = 2_147_483_648;
      },
    ],
    [
      "sequência com zeros",
      (m: StockMovement) => {
        m.sequence = "001";
      },
    ],
    [
      "sequência além BigInt",
      (m: StockMovement) => {
        m.sequence = "9223372036854775808";
      },
    ],
    [
      "tipo inválido",
      (m: StockMovement) => {
        m.type = "UNKNOWN" as StockMovement["type"];
      },
    ],
    [
      "timestamp inválido",
      (m: StockMovement) => {
        m.createdAt = "2026-02-30T12:00:00.000Z";
      },
    ],
    [
      "ID inválido",
      (m: StockMovement) => {
        m.product.id = "01";
      },
    ],
    [
      "snapshot ausente",
      (m: StockMovement) => {
        m.product.setName = "";
      },
    ],
    [
      "pedido inválido",
      (m: StockMovement) => {
        m.order!.orderNumber = 0;
      },
    ],
    [
      "motivo longo",
      (m: StockMovement) => {
        m.reason = "a".repeat(501);
      },
    ],
  ] as const)("recusa %s", async (_, corrupt) => {
    const value = movement();
    corrupt(value);
    vi.mocked(authorized).mockResolvedValue(page([value]));
    await expect(read()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("recusa sequência numérica que perde precisão", async () => {
    vi.mocked(authorized).mockResolvedValue(
      page([{ ...movement(), sequence: Number("9007199254740993") }]),
    );
    await expect(read()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("recusa IDs repetidos", async () => {
    vi.mocked(authorized).mockResolvedValue(
      page([movement(), { ...movement(), sequence: "1" }]),
    );
    await expect(read()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("recusa ordem de sequências invertida", async () => {
    vi.mocked(authorized).mockResolvedValue(
      page([
        { ...movement(), sequence: "1" },
        { ...movement(), id: id(10), sequence: "2" },
      ]),
    );
    await expect(read()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("recusa registro de outro produto no filtro", async () => {
    await expect(read({ productId: id(90) })).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
  it("recusa registro de tipo ou período incompatível", async () => {
    await expect(read({ type: "MANUAL_ADJUSTMENT" })).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
    await expect(
      read({ from: "2026-11-07T00:00:00.000Z" }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it.each([0, -1, 1.2, 1_000_001, NaN])(
    "recusa página %s sem consultar",
    async (number) => {
      await expect(read({}, number)).rejects.toMatchObject({ status: 400 });
      expect(authorized).not.toHaveBeenCalled();
    },
  );
  it.each([
    { productId: "01" },
    { type: "UNKNOWN" },
    { from: "ontem" },
    { extra: true },
    { from: date, to: date },
  ])("recusa filtros não canônicos %o", async (filters) => {
    await expect(read(filters as MovementFilters)).rejects.toMatchObject({
      status: 400,
    });
    expect(authorized).not.toHaveBeenCalled();
  });
  it("interrompe consulta já abortada", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(read({}, 1, controller)).rejects.toMatchObject({
      code: "ABORTED",
    });
    expect(authorized).not.toHaveBeenCalled();
  });
  it("respeita abort mesmo quando transporte não responde", async () => {
    vi.mocked(authorized).mockImplementation(() => new Promise(() => {}));
    const controller = new AbortController();
    const pending = read({}, 1, controller);
    const check = expect(pending).rejects.toMatchObject({ code: "ABORTED" });
    controller.abort();
    await check;
  });
  it("encerra em 15 segundos sem repetir a consulta", async () => {
    vi.useFakeTimers();
    vi.mocked(authorized).mockImplementation(() => new Promise(() => {}));
    const controller = new AbortController();
    const pending = read({}, 1, controller);
    const check = expect(pending).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(15_000);
    await check;
    expect(controller.signal.aborted).toBe(true);
    expect(authorized).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("remove listener e timer ao concluir", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    await read({}, 1, controller);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([400, 401, 403, 429, 503])(
    "sanitiza falha HTTP %s",
    async (status) => {
      vi.mocked(authorized).mockRejectedValue(
        Object.assign(new Error("SECRET_INTERNAL"), { status }),
      );
      await expect(read()).rejects.toMatchObject({ status });
      try {
        await read();
      } catch (error) {
        expect(movementError(error)).not.toContain("SECRET_INTERNAL");
      }
    },
  );
  it("não revela mensagens internas no erro genérico", () => {
    expect(movementError(new Error("SECRET_INTERNAL"))).not.toContain(
      "SECRET_INTERNAL",
    );
  });
});
