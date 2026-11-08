// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authorized } from "./session";
import {
  createReference,
  fetchReferenceOptions,
  referenceLabels,
  validateReference,
} from "./admin-references";
import type { ReferenceDraft, ReferenceKind } from "./admin-references";

vi.mock("./session", () => ({ authorized: vi.fn() }));
const id = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";
const category = { id, name: "Singles", slug: "singles", description: null };
const condition = {
  id,
  name: "Near Mint",
  code: "NM",
  description: "Linha um\nLinha dois",
};
const language = { id, name: "Português", code: "PT-BR" };
const options = () => ({
  categories: [category],
  conditions: [condition],
  languages: [language],
});
const draft = (changes: Partial<ReferenceDraft> = {}): ReferenceDraft => ({
  name: "Singles",
  identifier: "singles",
  description: "",
  ...changes,
});
const controller = () => new AbortController();
beforeEach(() => {
  vi.mocked(authorized).mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Reference validation", () => {
  it.each([
    [
      "category",
      " SINGLES ",
      { name: "Singles", slug: "singles", description: null },
    ],
    ["condition", " nm ", { name: "Singles", code: "NM", description: null }],
    ["language", " pt-br ", { name: "Singles", code: "PT-BR" }],
  ] as const)(
    "normalizes %s identifiers and only returns its documented fields",
    (kind, identifier, expected) => {
      expect(
        validateReference(kind, draft({ name: " Singles ", identifier })).input,
      ).toEqual(expected);
    },
  );
  it("keeps descriptions multiline and trims their edges", () => {
    expect(
      validateReference(
        "condition",
        draft({ identifier: "NM", description: " Linha um\r\n\tLinha dois " }),
      ).input?.description,
    ).toBe("Linha um\r\n\tLinha dois");
  });
  it.each([
    "",
    "  ",
    "Nome\npartido",
    `Nome${String.fromCharCode(0)}`,
    "x".repeat(121),
  ])("rejects invalid single-line names", (name) => {
    const result = validateReference("category", draft({ name }));
    expect(result.input).toBeUndefined();
    expect(result.errors.name).toBeTruthy();
  });
  it.each([
    "invalid slug",
    "-singles",
    "singles-",
    "two--words",
    "cartas_foils",
    "cartás",
    "x".repeat(101),
  ])("rejects invalid category identifiers", (identifier) => {
    expect(
      validateReference("category", draft({ identifier })).errors.identifier,
    ).toBeTruthy();
  });
  it.each(["pt br", "-NM", "NM-", "N--M", "N_M", "N\nM", "x".repeat(21)])(
    "rejects invalid condition/language identifiers",
    (identifier) => {
      for (const kind of ["condition", "language"] as const)
        expect(
          validateReference(kind, draft({ identifier })).errors.identifier,
        ).toBeTruthy();
    },
  );
  it("checks raw length before trimming as the backend does", () => {
    expect(
      validateReference("language", draft({ identifier: `${"X".repeat(20)} ` }))
        .errors.identifier,
    ).toBeTruthy();
    expect(
      validateReference("category", draft({ name: ` ${"N".repeat(120)}` }))
        .errors.name,
    ).toBeTruthy();
  });
  it.each([
    "x".repeat(2001),
    `Texto${String.fromCharCode(1)}`,
    `Texto${String.fromCharCode(127)}`,
  ])("rejects oversized or non-text description controls", (description) => {
    expect(
      validateReference("category", draft({ description })).errors.description,
    ).toBeTruthy();
  });
  it("accepts the documented maximum sizes", () => {
    expect(
      validateReference(
        "category",
        draft({
          name: "N".repeat(120),
          identifier: "x".repeat(100),
          description: "D".repeat(2000),
        }),
      ).input,
    ).toBeTruthy();
    expect(
      validateReference("condition", draft({ identifier: "X".repeat(20) }))
        .input,
    ).toBeTruthy();
  });
  it("ignores description for language and never adds it to the body", () => {
    expect(
      validateReference(
        "language",
        draft({ identifier: "PT", description: "não será enviada" }),
      ).input,
    ).toEqual({ name: "Singles", code: "PT" });
  });
  it("rejects an unknown kind without throwing or producing a body", () => {
    expect(validateReference("__proto__" as ReferenceKind, draft())).toEqual({
      errors: { name: "Tipo de cadastro inválido." },
    });
  });
  it("provides Portuguese labels for the three forms", () => {
    expect(referenceLabels("category").heading).toBe("Nova categoria");
    expect(referenceLabels("condition").identifier).toBe("Código da condição");
    expect(referenceLabels("language").example).toBe("PT-BR");
  });
});

describe("Reference API helpers", () => {
  it("reads active options via protected no-store GET, keeps legacy multiline text and strips private extras", async () => {
    vi.mocked(authorized).mockResolvedValue({
      ...options(),
      user: "private",
      categories: [{ ...category, active: true, secret: "private" }],
    });
    const abort = controller();
    const result = await fetchReferenceOptions(abort);
    expect(result).toEqual(options());
    expect(authorized).toHaveBeenCalledWith("/products/options", {
      method: "GET",
      signal: abort.signal,
      cache: "no-store",
    });
    expect(JSON.stringify(result)).not.toContain("private");
    expect(result.categories[0]).not.toHaveProperty("active");
  });
  it("accepts an empty options response", async () => {
    vi.mocked(authorized).mockResolvedValue({
      categories: [],
      conditions: [],
      languages: [],
    });
    expect(await fetchReferenceOptions(controller())).toEqual({
      categories: [],
      conditions: [],
      languages: [],
    });
  });
  it("does not impose an arbitrary maximum number of references", async () => {
    const rows = Array.from({ length: 125 }, (_, index) => ({
      ...category,
      id: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
      name: `Categoria ${index}`,
      slug: `categoria-${index}`,
    }));
    vi.mocked(authorized).mockResolvedValue({
      categories: rows,
      conditions: [],
      languages: [],
    });
    expect((await fetchReferenceOptions(controller())).categories).toHaveLength(
      125,
    );
  });
  it.each([
    null,
    [],
    { categories: [], conditions: [] },
    { ...options(), categories: [{ ...category, id: "not-uuid" }] },
    { ...options(), conditions: [{ ...condition, code: "nm" }] },
    { ...options(), languages: [{ ...language, name: "" }] },
    { ...options(), categories: [{ ...category, description: 42 }] },
    {
      ...options(),
      categories: [{ ...category, description: "x".repeat(2001) }],
    },
    { ...options(), conditions: [condition, condition] },
    { ...options(), conditions: [condition, { ...condition, id: secondId }] },
  ])(
    "rejects malformed options without returning private response content",
    async (value) => {
      vi.mocked(authorized).mockResolvedValue(value);
      await expect(fetchReferenceOptions(controller())).rejects.toThrow(
        /Resposta de cadastros? inválida\./,
      );
    },
  );
  it.each([
    [
      "category",
      {
        name: " Singles ",
        slug: " SINGLES ",
        code: "NO",
        active: false,
        description: " ",
      },
      "/products/categories",
      { name: "Singles", slug: "singles", description: null },
      category,
    ],
    [
      "condition",
      {
        name: "Near Mint",
        code: "nm",
        slug: "NO",
        description: "Linha um\nLinha dois",
      },
      "/products/conditions",
      { name: "Near Mint", code: "NM", description: "Linha um\nLinha dois" },
      condition,
    ],
    [
      "language",
      {
        name: "Português",
        code: "pt-br",
        slug: "NO",
        description: "NO",
        active: false,
      },
      "/products/languages",
      { name: "Português", code: "PT-BR" },
      language,
    ],
  ] as const)(
    "creates %s only through its own route and documented body",
    async (kind, input, path, expected, response) => {
      vi.mocked(authorized).mockResolvedValue({
        ...response,
        secret: "private",
        active: true,
      });
      const abort = controller();
      expect(await createReference(kind, input, abort)).toEqual(response);
      expect(authorized).toHaveBeenCalledTimes(1);
      expect(authorized).toHaveBeenCalledWith(path, {
        method: "POST",
        signal: abort.signal,
        cache: "no-store",
        body: JSON.stringify(expected),
      });
    },
  );
  it.each([
    ["category", { name: "Singles", slug: "bad slug" }],
    ["condition", { name: "", code: "NM" }],
    ["language", { name: "Português", code: "BAD_CODE" }],
  ] as const)("does not send an invalid %s creation", async (kind, input) => {
    await expect(createReference(kind, input, controller())).rejects.toThrow(
      "Dados de cadastro inválidos.",
    );
    expect(authorized).not.toHaveBeenCalled();
  });
  it.each([
    { ...category, name: "Other" },
    { ...category, slug: "other" },
    { ...category, id: "invalid" },
  ])("rejects a malformed or mismatched creation response", async (value) => {
    vi.mocked(authorized).mockResolvedValue(value);
    await expect(
      createReference(
        "category",
        { name: "Singles", slug: "singles" },
        controller(),
      ),
    ).rejects.toThrow("Resposta de cadastro inválida.");
  });
  it.each([400, 401, 403, 409, 503])(
    "keeps HTTP %i for the caller but sanitizes provider/internal text",
    async (status) => {
      vi.mocked(authorized).mockRejectedValue(
        Object.assign(new Error("private token and constraint"), { status }),
      );
      await expect(
        createReference(
          "condition",
          { name: "Near Mint", code: "NM" },
          controller(),
        ),
      ).rejects.toMatchObject({
        status,
        message: "Não foi possível consultar ou confirmar este cadastro.",
      });
      expect(authorized).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["read", "write"] as const)(
    "times out a %s whose client ignores abort and never retries it",
    async (mode) => {
      vi.useFakeTimers();
      vi.mocked(authorized).mockReturnValue(new Promise(() => {}));
      const abort = controller();
      const pending =
        mode === "read"
          ? fetchReferenceOptions(abort)
          : createReference(
              "language",
              { name: "Português", code: "PT-BR" },
              abort,
            );
      const expected = expect(pending).rejects.toThrow(
        "Não foi possível consultar ou confirmar este cadastro.",
      );
      await vi.advanceTimersByTimeAsync(15001);
      await expected;
      expect(abort.signal.aborted).toBe(true);
      expect(authorized).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it("aborts an in-flight request even if the underlying client never rejects", async () => {
    vi.mocked(authorized).mockReturnValue(new Promise(() => {}));
    const abort = controller();
    const pending = fetchReferenceOptions(abort);
    abort.abort();
    await expect(pending).rejects.toThrow(
      "Não foi possível consultar ou confirmar este cadastro.",
    );
  });
  it("does not issue requests for an already aborted controller", async () => {
    const abort = controller();
    abort.abort();
    await expect(fetchReferenceOptions(abort)).rejects.toThrow(
      "Consulta interrompida.",
    );
    expect(authorized).not.toHaveBeenCalled();
  });
});
