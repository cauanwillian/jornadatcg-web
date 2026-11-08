import { describe, expect, it } from "vitest";
import {
  changedProductFields,
  productDraft,
  validateProduct,
  validateStock,
  type AdminProduct,
  type ProductDraft,
} from "./admin-products";

const cardId = "11111111-1111-4111-8111-111111111111";
const categoryId = "22222222-2222-4222-8222-222222222222";
const conditionId = "33333333-3333-4333-8333-333333333333";
const languageId = "44444444-4444-4444-8444-444444444444";
const otherId = "55555555-5555-4555-8555-555555555555";

function draft(changes: Partial<ProductDraft> = {}): ProductDraft {
  return {
    cardId, categoryId, conditionId, languageId,
    price: "25,90", observation: "", active: true, featured: false,
    featuredOrder: "0", availableQuantity: "3", ...changes,
  };
}

function product(changes: Partial<AdminProduct> = {}): AdminProduct {
  return {
    id: otherId,
    price: "25.90", observation: null, active: true, featured: false,
    featuredOrder: 0, createdAt: "2026-10-22T12:00:00.000Z", updatedAt: "2026-10-22T12:00:00.000Z",
    card: {
      id: cardId, externalId: "local-card", name: "Pikachu", number: "025",
      imageSmall: null, imageLarge: null,
      set: { id: otherId, externalId: "local-set", name: "Coleção" },
    },
    category: { id: categoryId, name: "Cartas avulsas", slug: "cartas", active: true },
    condition: { id: conditionId, name: "Near mint", code: "NM", active: true },
    language: { id: languageId, name: "Português", code: "PT-BR", active: true },
    inventory: { availableQuantity: 3, reservedQuantity: 2, soldQuantity: 4, updatedAt: "2026-10-22T12:00:00.000Z" },
    ...changes,
  };
}

describe("admin product validation", () => {
  it.each([
    ["25,90", "25.90"], ["25.90", "25.90"], ["25", "25.00"],
    ["25,9", "25.90"], [" 0,01 ", "0.01"], ["9999999999,99", "9999999999.99"],
    ["0.10", "0.10"], ["1000000000.01", "1000000000.01"],
  ])("normalizes %s exactly to %s without rounding", (price, normalized) => {
    const result = validateProduct(draft({ price }), true);
    expect(result.errors).toEqual({});
    expect(result.input?.price).toBe(normalized);
  });

  it.each([
    "", "0", "0,00", "0.0", "-1", "+1", "1e3", "NaN", "Infinity",
    "25,999", "25.999", "1.000,00", "1,000.00", "1 000", "01.00",
    "10000000000", ".99", "1.", "1,", "1,,2", "1..2", "１",
  ])("rejects invalid or out of range price %s", (price) => {
    const result = validateProduct(draft({ price }), true);
    expect(result.input).toBeUndefined();
    expect(result.errors.price).toBeTruthy();
  });

  it.each(["cardId", "categoryId", "conditionId", "languageId"] as const)(
    "requires a valid %s for creation and editing", (field) => {
      for (const creating of [true, false]) {
        for (const invalid of ["", "ID_DO_PRODUTO", "11111111-1111-0111-8111-111111111111", "11111111-1111-4111-7111-111111111111"]) {
          const result = validateProduct(draft({ [field]: invalid }), creating);
          expect(result.errors[field]).toBeTruthy();
          expect(result.input).toBeUndefined();
        }
      }
    },
  );

  it("accepts reference UUID versions supported by the backend and trims selections", () => {
    expect(validateProduct(draft({ cardId: ` ${cardId.toUpperCase()} ` }), true).input?.cardId)
      .toBe(cardId.toUpperCase());
    expect(validateProduct(draft({ cardId: "11111111-1111-8111-8111-111111111111" }), true).errors)
      .toEqual({});
  });

  it("trims observation, converts blank text to null and respects its server limit", () => {
    expect(validateProduct(draft({ observation: "  Sem marcas  " }), true).input?.observation).toBe("Sem marcas");
    expect(validateProduct(draft({ observation: " \n " }), true).input?.observation).toBeNull();
    expect(validateProduct(draft({ observation: "a".repeat(2000) }), true).input?.observation).toHaveLength(2000);
    expect(validateProduct(draft({ observation: "a".repeat(2001) }), true).errors.observation).toBeTruthy();
  });

  it("requires initial stock on creation, and never blocks metadata editing with a stock input", () => {
    expect(validateProduct(draft({ availableQuantity: "" }), true).errors.availableQuantity).toBeTruthy();
    expect(validateProduct(draft({ availableQuantity: "0" }), true).input?.availableQuantity).toBe(0);
    const result = validateProduct(draft({ availableQuantity: "invalid" }), false);
    expect(result.errors).toEqual({});
    expect(changedProductFields(product(), result.input!)).not.toHaveProperty("availableQuantity");
  });

  it.each(["", "-1", "1.5", "1e2", "2147483648"])("rejects invalid featured order %s", (featuredOrder) => {
    expect(validateProduct(draft({ featuredOrder }), true).errors.featuredOrder).toBeTruthy();
  });

  it("preserves explicit false flags and zero featured order", () => {
    const result = validateProduct(draft({ active: false, featured: false, featuredOrder: "0" }), true);
    expect(result.input).toMatchObject({ active: false, featured: false, featuredOrder: 0 });
  });

  it("returns only the API's product input fields", () => {
    const values = { ...draft(), name: "not a product field", reservedQuantity: "99" };
    expect(validateProduct(values, true).input).toEqual({
      cardId, conditionId, languageId, categoryId, price: "25.90", observation: null,
      active: true, featured: false, featuredOrder: 0, availableQuantity: 3,
    });
  });
});

describe("stock validation", () => {
  it.each([["0", 0], [" 0 ", 0], ["31", 31], ["0003", 3], ["2147483647", 2147483647]])(
    "accepts %s preserving the integer %s", (input, value) => expect(validateStock(input)).toBe(value),
  );
  it.each(["", " ", "-0", "-1", "+1", "1.0", "1,0", "1e2", "1 000", "2147483648", "9007199254740993", "Infinity", "NaN", "２"])(
    "rejects %s without silently changing quantity", (input) => expect(validateStock(input)).toBeNull(),
  );
});

describe("product form state and metadata changes", () => {
  it("starts with no selected references and explicit inventory and flag defaults", () => {
    expect(productDraft()).toEqual({
      cardId: "", categoryId: "", conditionId: "", languageId: "", price: "", observation: "",
      active: true, featured: false, featuredOrder: "0", availableQuantity: "0",
    });
  });

  it("keeps false, zero, existing references and missing inventory when loading a product", () => {
    expect(productDraft(product({ active: false, featured: true, featuredOrder: 0, inventory: null })))
      .toMatchObject({ cardId, conditionId, categoryId, languageId, active: false, featured: true, availableQuantity: "0", price: "25.90" });
  });

  it("returns an empty patch for unchanged metadata even if available stock changed", () => {
    const before = product();
    const input = validateProduct(productDraft(before), false).input!;
    input.availableQuantity = 99;
    expect(changedProductFields(before, input)).toEqual({});
  });

  it("only includes changed metadata and preserves explicit false, zero and null values", () => {
    const before = product({ active: true, featured: true, featuredOrder: 2, observation: "Antes" });
    const input = validateProduct(draft({ active: false, featured: false, featuredOrder: "0", observation: "" }), false).input!;
    expect(changedProductFields(before, input)).toEqual({ active: false, featured: false, featuredOrder: 0, observation: null });
  });

  it("includes changed references and price while ignoring names and all inventory metadata", () => {
    const before = product();
    const input = {
      ...validateProduct(draft({ cardId: otherId, conditionId: otherId, categoryId: otherId, languageId: otherId, price: "1,01" }), false).input!,
      availableQuantity: 100, reservedQuantity: 300, soldQuantity: 400,
      name: "extra", inventory: { availableQuantity: 100 },
    };
    expect(changedProductFields(before, input)).toEqual({
      cardId: otherId, conditionId: otherId, categoryId: otherId, languageId: otherId, price: "1.01",
    });
  });
});
