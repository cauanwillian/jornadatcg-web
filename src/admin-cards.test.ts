// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authorized } from "./session";
import {
  cardError,
  fetchLocalCard,
  fetchLocalCards,
  importExternalCard,
  isImportableCard,
  searchExternalCards,
  validateCardSearch,
} from "./admin-cards";
import type { LocalCard } from "./admin-products";
import type { CardSearchDraft } from "./admin-cards";

vi.mock("./session", () => ({ authorized: vi.fn() }));
const id = "11111111-1111-4111-8111-111111111111";
const setId = "22222222-2222-4222-8222-222222222222";
const external = () => ({
  externalId: "tcggo_123",
  name: "Pikachu",
  number: "025",
  set: {
    externalId: "tcggo_episode_7",
    name: "Coleção Pokémon",
    printedTotal: 182,
  },
  rarity: "Rare",
  artist: "Artista",
  images: { small: "https://images.example.com/025.png", large: null },
});
const local = (): LocalCard => ({
  ...external(),
  id,
  createdAt: "2026-10-26T12:00:00.000Z",
  updatedAt: "2026-10-26T12:00:00.000Z",
  set: {
    ...external().set,
    id: setId,
    series: null,
    code: null,
    total: 200,
    releaseDate: "2026-01-15",
    logoUrl: null,
    symbolUrl: null,
  },
});
const controller = () => new AbortController();
const page = () => ({
  data: [local()],
  pagination: { page: 1, limit: 12, total: 1, totalPages: 1 },
});
const draft = (changes: Partial<CardSearchDraft> = {}): CardSearchDraft => ({
  name: "",
  code: "",
  ...changes,
});
beforeEach(() => {
  vi.mocked(authorized).mockReset();
});
afterEach(() => vi.useRealTimers());

describe("Card search validation", () => {
  it("trims name while preserving leading zeros in code", () => {
    expect(
      validateCardSearch(draft({ name: " Pikachu ", code: " 025/182 " })),
    ).toEqual({ query: { name: "Pikachu", code: "025/182" }, errors: {} });
  });
  it.each([
    [{ name: "Pikachu" }, { name: "Pikachu" }],
    [{ code: "025/182" }, { code: "025/182" }],
    [{ code: "203/182" }, { code: "203/182" }],
    [{ code: "000/001" }, { code: "000/001" }],
  ])(
    "accepts one field and secret cards beyond printed total",
    (input, query) =>
      expect(validateCardSearch(draft(input)).query).toEqual(query),
  );
  it("omits whitespace-only optional fields", () =>
    expect(
      validateCardSearch(draft({ name: "   ", code: "025/182" })).query,
    ).toEqual({ code: "025/182" }));
  it.each([draft(), draft({ name: " ", code: "  " })])(
    "requires at least one search value",
    (input) => {
      const result = validateCardSearch(input);
      expect(result.query).toBeUndefined();
      expect(result.errors.general).toBeTruthy();
    },
  );
  it.each([
    "025",
    "25 /182",
    "025-182",
    "-1/182",
    "1/0",
    "1/00",
    "1.5/182",
    "1/182/3",
    "9007199254740992/182",
    "1/9007199254740992",
    "1/1\n",
    "1/" + "1".repeat(32),
  ])("rejects invalid or unsafe codes", (code) => {
    const result = validateCardSearch(draft({ code }));
    expect(result.query).toBeUndefined();
    expect(result.errors.code).toBeTruthy();
  });
  it.each([
    "Pika\nchu",
    "Pika\tchu",
    `Pika${String.fromCharCode(0)}`,
    `Pika${String.fromCharCode(127)}`,
    "x".repeat(201),
  ])("rejects invalid name length or controls", (name) =>
    expect(validateCardSearch(draft({ name })).errors.name).toBeTruthy(),
  );
  it("uses raw lengths before trimming and accepts the maximum safe code", () => {
    expect(
      validateCardSearch(draft({ name: "x".repeat(200) })).query,
    ).toBeTruthy();
    expect(
      validateCardSearch(draft({ name: " " + "x".repeat(200) })).query,
    ).toBeUndefined();
    expect(
      validateCardSearch(draft({ code: "9007199254740991/9007199254740991" }))
        .query?.code,
    ).toBe("9007199254740991/9007199254740991");
  });
  it("handles runtime non-string fields safely", () => {
    expect(
      validateCardSearch({ name: [], code: {} } as unknown as CardSearchDraft)
        .query,
    ).toBeUndefined();
  });
});

describe("Card API helpers", () => {
  it("requests the local catalog with encoded name, 12 rows, no-store and abort signal", async () => {
    vi.mocked(authorized).mockResolvedValue(page());
    const abort = controller();
    expect(
      await fetchLocalCards({ page: 1, name: " Mew & Pikachu " }, abort),
    ).toEqual(page());
    expect(authorized).toHaveBeenCalledWith(
      "/cards?page=1&limit=12&name=Mew+%26+Pikachu",
      { method: "GET", cache: "no-store", signal: abort.signal },
    );
  });
  it("accepts an empty catalog with totalPages zero", async () => {
    const empty = {
      data: [],
      pagination: { page: 1, limit: 12, total: 0, totalPages: 0 },
    };
    vi.mocked(authorized).mockResolvedValue(empty);
    expect(await fetchLocalCards({ page: 1 }, controller())).toEqual(empty);
  });
  it("accepts an out-of-range page as empty without declaring an invalid response", async () => {
    const empty = {
      data: [],
      pagination: { page: 3, limit: 12, total: 1, totalPages: 1 },
    };
    vi.mocked(authorized).mockResolvedValue(empty);
    expect(await fetchLocalCards({ page: 3 }, controller())).toEqual(empty);
  });
  it.each([
    { page: 0 },
    { page: 1.5 },
    { page: 10001 },
    { page: 1, name: "" },
    { page: 1, name: "\n" },
    { page: 1, name: "x".repeat(201) },
  ])("rejects invalid local query without sending", async (query) => {
    await expect(fetchLocalCards(query, controller())).rejects.toMatchObject({
      status: 400,
    });
    expect(authorized).not.toHaveBeenCalled();
  });
  it("loads one local card by its UUID and strips extra response fields", async () => {
    vi.mocked(authorized).mockResolvedValue({
      ...local(),
      private: "SECRET",
      set: { ...local().set, private: "SECRET" },
    });
    expect(await fetchLocalCard(id, controller())).toEqual(local());
    expect(authorized).toHaveBeenCalledWith(
      `/cards/${id}`,
      expect.objectContaining({ method: "GET", cache: "no-store" }),
    );
  });
  it("rejects non-UUID local detail IDs before calling the API", async () => {
    await expect(
      fetchLocalCard("tcggo_123", controller()),
    ).rejects.toMatchObject({ status: 400 });
    expect(authorized).not.toHaveBeenCalled();
  });
  it("rejects a detail response for a different local UUID", async () => {
    vi.mocked(authorized).mockResolvedValue({ ...local(), id: setId });
    await expect(fetchLocalCard(id, controller())).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
  it("searches by normalized name and original code without pagination or provider credentials", async () => {
    vi.mocked(authorized).mockResolvedValue([
      { ...external(), secret: "SECRET" },
    ]);
    const result = await searchExternalCards(
      { name: " Mr. Mime & Mew ", code: "025/182" },
      controller(),
    );
    expect(result).toEqual([external()]);
    expect(authorized).toHaveBeenCalledWith(
      "/cards/search?name=Mr.+Mime+%26+Mew&code=025%2F182",
      expect.objectContaining({ method: "GET", cache: "no-store" }),
    );
    expect(JSON.stringify(vi.mocked(authorized).mock.calls)).not.toMatch(
      /api.key|rapidapi|page=/i,
    );
  });
  it("accepts an empty external search", async () => {
    vi.mocked(authorized).mockResolvedValue([]);
    expect(
      await searchExternalCards({ name: "Pikachu" }, controller()),
    ).toEqual([]);
  });
  it("does not impose an invented external result limit", async () => {
    const rows = Array.from({ length: 125 }, (_, index) => ({
      ...external(),
      externalId: `tcggo_${index + 1}`,
    }));
    vi.mocked(authorized).mockResolvedValue(rows);
    expect(
      await searchExternalCards({ name: "Pikachu" }, controller()),
    ).toHaveLength(125);
  });
  it("rejects invalid external input before sending", async () => {
    await expect(
      searchExternalCards({ code: "025/0" }, controller()),
    ).rejects.toMatchObject({ status: 400 });
    expect(authorized).not.toHaveBeenCalled();
  });
  it("imports only the selected externalId and accepts the canonical local response", async () => {
    vi.mocked(authorized).mockResolvedValue(local());
    const abort = controller();
    expect(await importExternalCard("tcggo_123", abort)).toEqual(local());
    expect(authorized).toHaveBeenCalledWith("/cards/import", {
      method: "POST",
      body: '{"externalId":"tcggo_123"}',
      signal: abort.signal,
      cache: "no-store",
    });
    expect(authorized).toHaveBeenCalledTimes(1);
  });
  it("can explicitly resume the same import without creating a different identifier", async () => {
    vi.mocked(authorized).mockResolvedValue(local());
    await importExternalCard("tcggo_123", controller());
    await importExternalCard("tcggo_123", controller());
    expect(
      vi.mocked(authorized).mock.calls.map(([, request]) => request?.body),
    ).toEqual(['{"externalId":"tcggo_123"}', '{"externalId":"tcggo_123"}']);
  });
  it.each([
    "old-provider-id",
    "tcggo_0",
    "tcggo_01",
    "tcggo_-1",
    "tcggo_1.1",
    " tcggo_1",
    "tcggo_9007199254740992",
    "../tcggo_1",
  ])("rejects unsupported new source ID %s", async (value) => {
    expect(isImportableCard(value)).toBe(false);
    await expect(importExternalCard(value, controller())).rejects.toMatchObject(
      { status: 400 },
    );
    expect(authorized).not.toHaveBeenCalled();
  });
  it("accepts the largest safe TCGGO identifier", () =>
    expect(isImportableCard("tcggo_9007199254740991")).toBe(true));
  it("rejects an import response for another external ID", async () => {
    vi.mocked(authorized).mockResolvedValue({
      ...local(),
      externalId: "tcggo_456",
    });
    await expect(
      importExternalCard("tcggo_123", controller()),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("keeps legacy local provider IDs and nullable collection counts usable", async () => {
    const legacy = {
      ...local(),
      externalId: "legacy-provider-card",
      number: "TG01",
      set: {
        ...local().set,
        printedTotal: null,
        total: null,
        releaseDate: null,
      },
    };
    vi.mocked(authorized).mockResolvedValue(legacy);
    expect(await fetchLocalCard(id, controller())).toEqual(legacy);
  });
  it.each([
    "javascript:alert(1)",
    "data:image/svg+xml,hidden",
    "/relative.png",
    "https://user:password@example.com/image.png",
    "malformed",
  ])("renders unsafe or invalid external image URLs as absent", async (url) => {
    vi.mocked(authorized).mockResolvedValue([
      {
        ...external(),
        images: { small: url, large: "http://images.example.com/large.png" },
      },
    ]);
    const result = await searchExternalCards({ name: "Pikachu" }, controller());
    expect(result[0].images).toEqual({
      small: null,
      large: "http://images.example.com/large.png",
    });
  });
  it.each([
    { data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } },
    { data: [], pagination: { page: 1, limit: 12, total: 1, totalPages: 1 } },
    {
      data: [local()],
      pagination: { page: 2, limit: 12, total: 1, totalPages: 1 },
    },
    {
      data: [local()],
      pagination: { page: 1, limit: 12, total: 1, totalPages: 0 },
    },
    {
      data: [local(), local()],
      pagination: { page: 1, limit: 12, total: 2, totalPages: 1 },
    },
  ])("rejects inconsistent local pagination and duplicates", async (value) => {
    vi.mocked(authorized).mockResolvedValue(value);
    await expect(
      fetchLocalCards({ page: 1 }, controller()),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it.each([
    null,
    {},
    { data: [external()] },
    [null],
    [{ ...external(), set: { ...external().set, printedTotal: null } }],
    [{ ...external(), name: " " }],
    [external(), external()],
  ])("rejects invalid external response shapes", async (value) => {
    vi.mocked(authorized).mockResolvedValue(value);
    await expect(
      searchExternalCards({ name: "Pikachu" }, controller()),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it.each([
    { ...local(), id: "not-uuid" },
    { ...local(), images: { small: 10, large: null } },
    { ...local(), updatedAt: "today" },
    { ...local(), set: { ...local().set, releaseDate: "2026-02-31" } },
    { ...local(), set: { ...local().set, printedTotal: -1 } },
  ])("rejects malformed local card detail", async (value) => {
    vi.mocked(authorized).mockResolvedValue(value);
    await expect(fetchLocalCard(id, controller())).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
});

describe("Card request reliability", () => {
  it("sanitizes internal errors while preserving a valid HTTP status", async () => {
    vi.mocked(authorized).mockRejectedValue(
      Object.assign(new Error("SECRET_API_KEY_AND_DB_ERROR"), { status: 503 }),
    );
    let failure: unknown;
    try {
      await importExternalCard("tcggo_123", controller());
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ status: 503 });
    expect(String(failure)).not.toContain("SECRET");
    expect(cardError(failure, "import")).toContain("pode ter sido concluída");
    expect(authorized).toHaveBeenCalledTimes(1);
  });
  it.each([0, 700, "503", 503.5, NaN])(
    "does not trust malformed status metadata",
    async (status) => {
      vi.mocked(authorized).mockRejectedValue({ status, message: "SECRET" });
      await expect(fetchLocalCard(id, controller())).rejects.not.toHaveProperty(
        "status",
      );
    },
  );
  it("aborts and settles after 15s even if the underlying request ignores cancellation", async () => {
    vi.useFakeTimers();
    vi.mocked(authorized).mockReturnValue(new Promise(() => {}));
    const abort = controller();
    const pending = importExternalCard("tcggo_123", abort);
    const assertion = expect(pending).rejects.toMatchObject({
      code: "TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(15000);
    await assertion;
    expect(abort.signal.aborted).toBe(true);
    expect(authorized).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cleans timer and listener after a normal response", async () => {
    vi.useFakeTimers();
    vi.mocked(authorized).mockResolvedValue(local());
    const abort = controller();
    const remove = vi.spyOn(abort.signal, "removeEventListener");
    await fetchLocalCard(id, abort);
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    await vi.advanceTimersByTimeAsync(15000);
    expect(abort.signal.aborted).toBe(false);
  });
  it("settles explicit cancellation even when the underlying request ignores it", async () => {
    vi.mocked(authorized).mockReturnValue(new Promise(() => {}));
    const abort = controller();
    const pending = searchExternalCards({ name: "Pikachu" }, abort);
    abort.abort();
    await expect(pending).rejects.toMatchObject({ code: "ABORTED" });
  });
  it("does not send a request after cancellation", async () => {
    const abort = controller();
    abort.abort();
    await expect(fetchLocalCard(id, abort)).rejects.toMatchObject({
      code: "ABORTED",
    });
    expect(authorized).not.toHaveBeenCalled();
  });
  it.each([
    [{ status: 401 }, "local", "sessão expirou"],
    [{ status: 403 }, "import", "administradores"],
    [{ status: 400 }, "search", "muito ampla"],
    [{ status: 404 }, "local", "não encontrada"],
    [{ status: 409 }, "import", "número na coleção"],
    [{ status: 429 }, "search", "limite de consultas"],
    [{ status: 503 }, "search", "configuração da API"],
    [{ status: 503 }, "local", "temporariamente indisponível"],
    [{ status: 504 }, "search", "demorou"],
    [{ code: "INVALID_RESPONSE" }, "local", "ler os dados"],
    [
      { message: "SECRET", stack: "SECRET" },
      "import",
      "pode ter sido concluída",
    ],
  ] as const)(
    "presents a fixed useful error message",
    (error, action, phrase) => {
      const message = cardError(error, action);
      expect(message.toLowerCase()).toContain(phrase.toLowerCase());
      expect(message).not.toContain("SECRET");
    },
  );
});
