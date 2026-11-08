// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authorized } from "./session";
import {
  fetchInventory,
  inventoryError,
  validateInventoryFilters,
} from "./admin-inventory";
import type {
  InventoryFilterDraft,
  InventoryFilters,
  InventoryPage,
  InventoryRow,
} from "./admin-inventory";

vi.mock("./session", () => ({ authorized: vi.fn() }));
const id = (number: number) =>
  `${number.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`;
const date = "2026-11-05T12:30:00.000Z";
const defaults: InventoryFilters = { lowStockThreshold: 5 };
const draft = (
  changes: Partial<InventoryFilterDraft> = {},
): InventoryFilterDraft => ({
  name: "",
  active: "",
  stock: "",
  lowStockThreshold: "5",
  ...changes,
});
const row = (
  number = 1,
  inventory: InventoryRow["inventory"] = {
    availableQuantity: 2,
    reservedQuantity: 1,
    soldQuantity: 4,
    updatedAt: date,
  },
): InventoryRow => ({
  id: id(number),
  active: true,
  card: {
    id: id(100),
    name: "Pikachu",
    number: "025",
    set: { id: id(101), name: "Coleção de demonstração" },
  },
  category: { id: id(102), name: "Cartas avulsas" },
  condition: { id: id(103), name: "Near Mint" },
  language: { id: id(104), name: "Português" },
  inventory,
});
const page = (
  items: InventoryRow[] = [
    row(),
    row(2, {
      availableQuantity: 0,
      reservedQuantity: 2,
      soldQuantity: 5,
      updatedAt: date,
    }),
    row(3, null),
  ],
): InventoryPage => ({
  items,
  page: 1,
  pageSize: 20,
  total: items.length,
  lowStockThreshold: 5,
  summary: {
    productCount: items.length,
    availableCount: items.filter(
      (item) => item.inventory && item.inventory.availableQuantity > 0,
    ).length,
    outOfStockCount: items.filter(
      (item) => item.inventory && item.inventory.availableQuantity === 0,
    ).length,
    lowStockCount: items.filter(
      (item) =>
        item.inventory &&
        item.inventory.availableQuantity > 0 &&
        item.inventory.availableQuantity <= 5,
    ).length,
    reservedCount: items.filter(
      (item) => item.inventory && item.inventory.reservedQuantity > 0,
    ).length,
    missingInventoryCount: items.filter((item) => item.inventory === null)
      .length,
  },
});
const controller = () => new AbortController();
beforeEach(() => {
  vi.mocked(authorized).mockReset();
  vi.mocked(authorized).mockResolvedValue(page());
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Filtros de estoque administrativo", () => {
  it("aceita todos os anúncios com limite de cinco e normaliza um nome literal", () => {
    expect(validateInventoryFilters(draft())).toEqual({
      query: defaults,
      errors: {},
    });
    expect(
      validateInventoryFilters(
        draft({
          name: " Pikachu _% ",
          active: "false",
          stock: "low",
          lowStockThreshold: " 7 ",
        }),
      ),
    ).toEqual({
      query: {
        name: "Pikachu _%",
        active: "false",
        stock: "low",
        lowStockThreshold: 7,
      },
      errors: {},
    });
  });
  it.each(["available", "out", "low", "reserved", "missing"])(
    "aceita a situação %s",
    (stock) => {
      expect(validateInventoryFilters(draft({ stock })).query?.stock).toBe(
        stock,
      );
    },
  );
  it.each([
    "",
    "0",
    "-1",
    "1.5",
    "2e2",
    "+5",
    "05",
    "2147483648",
    "Infinity",
    "NaN",
    "1\n2",
  ])("recusa limite inválido %j", (lowStockThreshold) => {
    const result = validateInventoryFilters(draft({ lowStockThreshold }));
    expect(result.query).toBeUndefined();
    expect(result.errors.lowStockThreshold).toBeTruthy();
  });
  it("aceita o limite máximo da coluna sem arredondamento", () => {
    expect(
      validateInventoryFilters(draft({ lowStockThreshold: "2147483647" })).query
        ?.lowStockThreshold,
    ).toBe(2_147_483_647);
  });
  it.each([
    ["name", "a".repeat(201)],
    ["name", "Pika\u0000chu"],
    ["name", "Pika\nchu"],
    ["name", "Pika\u007fchu"],
    ["active", "yes"],
    ["active", "TRUE"],
    ["stock", "zero"],
    ["stock", "AVAILABLE"],
  ])("recusa %s inválido", (field, value) => {
    const result = validateInventoryFilters(draft({ [field]: value }));
    expect(result.query).toBeUndefined();
    expect(result.errors[field as keyof InventoryFilterDraft]).toBeTruthy();
  });
  it("omite busca com espaços e aceita nome de 200 caracteres", () => {
    expect(validateInventoryFilters(draft({ name: "   " })).query).toEqual(
      defaults,
    );
    expect(
      validateInventoryFilters(draft({ name: "a".repeat(200) })).query?.name,
    ).toHaveLength(200);
  });
});

describe("Consulta e normalização de estoque", () => {
  it("usa somente GET sem cache e preserva nomes literais na URL", async () => {
    const data = page([row()]);
    data.lowStockThreshold = 7;
    vi.mocked(authorized).mockResolvedValue(data);
    const abort = controller();
    await fetchInventory(
      {
        name: " Pikachu _% ",
        active: "true",
        stock: "low",
        lowStockThreshold: 7,
      },
      1,
      abort,
    );
    const [path, options] = vi.mocked(authorized).mock.calls[0];
    const query = new URL(path, "http://localhost");
    expect(query.pathname).toBe("/admin/inventory");
    expect(Object.fromEntries(query.searchParams)).toEqual({
      page: "1",
      pageSize: "20",
      lowStockThreshold: "7",
      name: "Pikachu _%",
      active: "true",
      stock: "low",
    });
    expect(options).toEqual({
      method: "GET",
      cache: "no-store",
      signal: abort.signal,
    });
  });
  it("distingue inventário ausente de estoque zerado e aceita reservas sobrepostas", async () => {
    const data = await fetchInventory(defaults, 1, controller());
    expect(data.items[1].inventory?.availableQuantity).toBe(0);
    expect(data.items[2].inventory).toBeNull();
    expect(data.summary).toEqual({
      productCount: 3,
      availableCount: 1,
      outOfStockCount: 1,
      lowStockCount: 1,
      reservedCount: 2,
      missingInventoryCount: 1,
    });
    expect(
      data.summary.lowStockCount + data.summary.reservedCount,
    ).toBeGreaterThan(data.summary.availableCount);
  });
  it("retém somente o contrato em todas as camadas da resposta", async () => {
    const data = page();
    const first = data.items[0];
    Object.assign(data, { secret: "PRIVATE" });
    Object.assign(first, { price: "1.00", observation: "PRIVATE" });
    Object.assign(first.card, { externalId: "PRIVATE", imageSmall: "PRIVATE" });
    Object.assign(first.card.set, { provider: "PRIVATE" });
    Object.assign(first.inventory!, { ownerId: "PRIVATE" });
    Object.assign(first.category, { active: true });
    Object.assign(data.summary, { internalId: "PRIVATE" });
    vi.mocked(authorized).mockResolvedValue(data);
    const normalized = await fetchInventory(defaults, 1, controller());
    expect(normalized).toEqual(page());
    expect(JSON.stringify(normalized)).not.toContain("PRIVATE");
  });
  it("mantém o resumo do conjunto todo ao abrir a segunda página", async () => {
    const data = page([row(21)]);
    data.page = 2;
    data.total = 21;
    data.summary = {
      productCount: 21,
      availableCount: 21,
      outOfStockCount: 0,
      lowStockCount: 17,
      reservedCount: 12,
      missingInventoryCount: 0,
    };
    vi.mocked(authorized).mockResolvedValue(data);
    const result = await fetchInventory(defaults, 2, controller());
    expect(result.items).toHaveLength(1);
    expect(result.summary.lowStockCount).toBe(17);
    expect(result.total).toBe(21);
  });
  it("aceita lista vazia e página sem linhas além do fim", async () => {
    vi.mocked(authorized).mockResolvedValue(page([]));
    expect((await fetchInventory(defaults, 1, controller())).items).toEqual([]);
    const later = page([row()]);
    later.page = 3;
    later.items = [];
    vi.mocked(authorized).mockResolvedValue(later);
    expect((await fetchInventory(defaults, 3, controller())).items).toEqual([]);
  });
  it.each([
    ["available", row()],
    [
      "out",
      row(1, {
        availableQuantity: 0,
        reservedQuantity: 1,
        soldQuantity: 2,
        updatedAt: date,
      }),
    ],
    ["low", row()],
    ["reserved", row()],
    ["missing", row(1, null)],
  ] as const)("aceita linhas compatíveis com %s", async (stock, item) => {
    vi.mocked(authorized).mockResolvedValue(page([item]));
    expect(
      (await fetchInventory({ ...defaults, stock }, 1, controller())).items,
    ).toEqual([item]);
  });
  it.each([
    ["available", row(1, null)],
    ["out", row(1, null)],
    [
      "low",
      row(1, {
        availableQuantity: 0,
        reservedQuantity: 0,
        soldQuantity: 0,
        updatedAt: date,
      }),
    ],
    [
      "reserved",
      row(1, {
        availableQuantity: 2,
        reservedQuantity: 0,
        soldQuantity: 1,
        updatedAt: date,
      }),
    ],
    ["missing", row()],
  ] as const)("recusa linha incompatível com %s", async (stock, item) => {
    vi.mocked(authorized).mockResolvedValue(page([item]));
    await expect(
      fetchInventory({ ...defaults, stock }, 1, controller()),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("recusa anúncio ativo em consulta por inativos", async () => {
    await expect(
      fetchInventory({ ...defaults, active: "false" }, 1, controller()),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("aceita saldos máximos e não calcula valor monetário ou saldo físico", async () => {
    const data = page([
      row(1, {
        availableQuantity: 2_147_483_647,
        reservedQuantity: 2_147_483_647,
        soldQuantity: 2_147_483_647,
        updatedAt: date,
      }),
    ]);
    vi.mocked(authorized).mockResolvedValue(data);
    expect(
      (await fetchInventory(defaults, 1, controller())).items[0].inventory,
    ).toEqual(data.items[0].inventory);
  });
  it.each([
    (value: InventoryPage) => {
      value.page = 2;
    },
    (value: InventoryPage) => {
      value.pageSize = 100;
    },
    (value: InventoryPage) => {
      value.lowStockThreshold = 6;
    },
    (value: InventoryPage) => {
      value.total = -1;
    },
    (value: InventoryPage) => {
      value.total = Number.MAX_SAFE_INTEGER + 1;
    },
    (value: InventoryPage) => {
      value.items = [];
    },
    (value: InventoryPage) => {
      value.items[1] = {
        ...value.items[0],
        id: value.items[0].id.toUpperCase(),
      };
    },
    (value: InventoryPage) => {
      value.summary.productCount = 2;
    },
    (value: InventoryPage) => {
      value.summary.availableCount = 3;
    },
    (value: InventoryPage) => {
      value.summary.lowStockCount = 2;
    },
    (value: InventoryPage) => {
      value.summary.reservedCount = 3;
    },
    (value: InventoryPage) => {
      value.summary.outOfStockCount = -1;
    },
    (value: InventoryPage) => {
      value.summary.lowStockCount = 0;
    },
  ])("recusa paginação ou resumo inconsistente %#", async (change) => {
    const data = page();
    change(data);
    vi.mocked(authorized).mockResolvedValue(data);
    await expect(
      fetchInventory(defaults, 1, controller()),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it.each([
    (value: InventoryRow) => {
      value.id = "01";
    },
    (value: InventoryRow) => {
      Object.assign(value, { active: "true" });
    },
    (value: InventoryRow) => {
      value.card.id = "01";
    },
    (value: InventoryRow) => {
      value.card.name = " ";
    },
    (value: InventoryRow) => {
      value.card.number = "";
    },
    (value: InventoryRow) => {
      value.card.set.id = "01";
    },
    (value: InventoryRow) => {
      value.category.name = " ";
    },
    (value: InventoryRow) => {
      value.condition.id = "01";
    },
    (value: InventoryRow) => {
      value.language.name = "";
    },
    (value: InventoryRow) => {
      Object.assign(value, { inventory: undefined });
    },
    (value: InventoryRow) => {
      value.inventory!.availableQuantity = -1;
    },
    (value: InventoryRow) => {
      value.inventory!.reservedQuantity = 1.5;
    },
    (value: InventoryRow) => {
      value.inventory!.soldQuantity = 2_147_483_648;
    },
    (value: InventoryRow) => {
      value.inventory!.updatedAt = "2026-02-30T12:30:00.000Z";
    },
  ])("recusa registro malformado %#", async (change) => {
    const data = page();
    change(data.items[0]);
    vi.mocked(authorized).mockResolvedValue(data);
    await expect(
      fetchInventory(defaults, 1, controller()),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it.each([null, [], { items: [] }, { ...page(), summary: null }])(
    "recusa estrutura de resposta inválida %#",
    async (response) => {
      vi.mocked(authorized).mockResolvedValue(response);
      await expect(
        fetchInventory(defaults, 1, controller()),
      ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    },
  );
  it.each([0, -1, 1.5, 1_000_001, Number.MAX_SAFE_INTEGER + 1])(
    "recusa página %s antes de consultar",
    async (number) => {
      await expect(
        fetchInventory(defaults, number, controller()),
      ).rejects.toMatchObject({ status: 400 });
      expect(authorized).not.toHaveBeenCalled();
    },
  );
  it.each([
    { lowStockThreshold: 0 },
    { lowStockThreshold: 2_147_483_648 },
    { lowStockThreshold: 1.5 },
    { lowStockThreshold: "5" },
    { ...defaults, name: " " },
    { ...defaults, name: "a".repeat(201) },
    { ...defaults, name: "Pika\nchu" },
    { ...defaults, active: true },
    { ...defaults, stock: "all" },
    { ...defaults, unknown: "secret" },
  ])(
    "recusa filtros fora do contrato antes da consulta %#",
    async (filters) => {
      await expect(
        fetchInventory(filters as InventoryFilters, 1, controller()),
      ).rejects.toMatchObject({ status: 400 });
      expect(authorized).not.toHaveBeenCalled();
    },
  );
});

describe("Interrupção e falhas de leitura do estoque", () => {
  it("não consulta se o sinal já foi interrompido", async () => {
    const abort = controller();
    abort.abort();
    await expect(fetchInventory(defaults, 1, abort)).rejects.toMatchObject({
      code: "ABORTED",
    });
    expect(authorized).not.toHaveBeenCalled();
  });
  it("encerra a espera e remove listener ao interromper um transporte que ignora abort", async () => {
    vi.useFakeTimers();
    let resolve!: (value: InventoryPage) => void;
    vi.mocked(authorized).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const abort = controller();
    const remove = vi.spyOn(abort.signal, "removeEventListener");
    const promise = fetchInventory(defaults, 1, abort);
    const result = expect(promise).rejects.toMatchObject({ code: "ABORTED" });
    abort.abort();
    await result;
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
    resolve(page());
    await Promise.resolve();
    expect(authorized).toHaveBeenCalledTimes(1);
  });
  it("aplica prazo de quinze segundos sem repetir a consulta", async () => {
    vi.useFakeTimers();
    vi.mocked(authorized).mockReturnValue(new Promise(() => {}));
    const abort = controller();
    const promise = fetchInventory(defaults, 1, abort);
    const result = expect(promise).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(15_000);
    await result;
    expect(abort.signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(authorized).toHaveBeenCalledTimes(1);
  });
  it("limpa o prazo e listener após sucesso sem tocar em storage", async () => {
    vi.useFakeTimers();
    const storage = vi.spyOn(Storage.prototype, "setItem");
    const abort = controller();
    const remove = vi.spyOn(abort.signal, "removeEventListener");
    await fetchInventory(defaults, 1, abort);
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(storage).not.toHaveBeenCalled();
  });
  it.each([401, 403, 429, 503])(
    "preserva apenas status %s da falha e remove detalhes internos",
    async (status) => {
      vi.mocked(authorized).mockRejectedValue(
        Object.assign(new Error("DATABASE_PASSWORD_SECRET"), {
          status,
          raw: "PRIVATE",
          code: "PRIVATE",
        }),
      );
      const error = await fetchInventory(defaults, 1, controller()).catch(
        (caught: unknown) => caught,
      );
      expect(error).toMatchObject({ status });
      expect(String(error)).not.toContain("SECRET");
      expect(JSON.stringify(error)).not.toContain("PRIVATE");
      expect(inventoryError(error)).not.toContain("SECRET");
    },
  );
  it.each([
    [{ status: 400 }, "Confira os filtros"],
    [{ status: 401 }, "Sua sessão expirou"],
    [{ status: 403 }, "Acesso restrito"],
    [{ status: 429 }, "Muitas consultas"],
    [{ status: 504 }, "demorou"],
    [{ code: "TIMEOUT" }, "demorou"],
    [{ code: "INVALID_RESPONSE" }, "conferir os dados"],
    [new Error("PRIVATE"), "Não foi possível carregar"],
  ])("explica falhas sem usar mensagem externa %#", (error, expected) => {
    expect(inventoryError(error)).toContain(expected);
    expect(inventoryError(error)).not.toContain("PRIVATE");
  });
});
