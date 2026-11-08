// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensureShipmentAttempt,
  forgetShipmentAttempt,
  loadShipmentAttempt,
} from "./shipping";
import type { ShipmentInput } from "./shipping";

const key = "68a7b7af-18a9-46ab-b44d-a7438cbb5c02";
const otherKey = "893a8f02-6d64-4c12-9f13-70c26314c11b";
const addressId = "e01b7f30-c1aa-4038-810b-0501fb301ad4";
const itemA = "a01b7f30-c1aa-4038-810b-0501fb301ad4";
const itemB = "b01b7f30-c1aa-4038-810b-0501fb301ad4";
const selection = (quantity = 1): ShipmentInput => ({
  addressId,
  items: [{ orderItemId: itemA, quantity }],
});

beforeEach(() => {
  sessionStorage.clear();
  vi.spyOn(crypto, "randomUUID").mockReturnValue(key);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Shipment request recovery", () => {
  it("persists before returning a request and reuses the original body after selection changes", () => {
    const input = selection(2);
    const first = ensureShipmentAttempt("customer", input);
    const stored = JSON.parse(sessionStorage.getItem(sessionStorage.key(0)!)!);
    expect(stored).toEqual({ key, input });
    input.items[0].quantity = 9;
    const changed = {
      addressId: otherKey,
      items: [{ orderItemId: itemB, quantity: 4 }],
    };
    expect(ensureShipmentAttempt("customer", changed)).toEqual(first);
    expect(first.input.items[0].quantity).toBe(2);
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
    expect(Object.keys(stored)).toEqual(["key", "input"]);
    expect(Object.keys(stored.input)).toEqual(["addressId", "items"]);
  });

  it("recovers an existing request even when the latest selection is no longer valid", () => {
    const first = ensureShipmentAttempt("customer", selection());
    expect(ensureShipmentAttempt("customer", selection(0))).toEqual(first);
  });

  it("isolates saved requests by account", () => {
    const first = ensureShipmentAttempt("first", selection(1));
    expect(loadShipmentAttempt("second")).toBeNull();
    vi.mocked(crypto.randomUUID).mockReturnValueOnce(otherKey);
    const second = ensureShipmentAttempt("second", selection(2));
    expect(loadShipmentAttempt("first")).toEqual(first);
    expect(loadShipmentAttempt("second")).toEqual(second);
    forgetShipmentAttempt("first", first.key);
    expect(loadShipmentAttempt("first")).toBeNull();
    expect(loadShipmentAttempt("second")).toEqual(second);
  });

  it("restores after a module reload without generating a new id", async () => {
    const first = ensureShipmentAttempt("customer", selection(2));
    vi.resetModules();
    const reloaded = await import("./shipping");
    expect(reloaded.ensureShipmentAttempt("customer", selection(3))).toEqual(
      first,
    );
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
  });

  it("normalizes UUID case and sorts item IDs before persisting", () => {
    const attempt = ensureShipmentAttempt("customer", {
      addressId: addressId.toUpperCase(),
      items: [
        { orderItemId: itemB.toUpperCase(), quantity: 40 },
        { orderItemId: itemA.toUpperCase(), quantity: 30 },
      ],
    });
    expect(attempt.input).toEqual({
      addressId,
      items: [
        { orderItemId: itemA, quantity: 30 },
        { orderItemId: itemB, quantity: 40 },
      ],
    });
  });

  it.each([1, 30, 31, 70])(
    "accepts a package containing %s cards",
    (quantity) => {
      expect(
        ensureShipmentAttempt("customer", selection(quantity)).input,
      ).toEqual(selection(quantity));
    },
  );

  it.each([0, -1, 1.5, 71, Number.NaN, Number.POSITIVE_INFINITY, "1", null])(
    "rejects invalid quantities before preparing a request: %s",
    (quantity) => {
      expect(() =>
        ensureShipmentAttempt("customer", selection(quantity as number)),
      ).toThrow("1 a 70");
      expect(sessionStorage.length).toBe(0);
      expect(crypto.randomUUID).not.toHaveBeenCalled();
    },
  );

  it.each([
    { addressId, items: [] },
    { addressId: "invalid", items: selection().items },
    { addressId: addressId.replace("4038", "3038"), items: selection().items },
    { addressId, items: [{ orderItemId: "invalid", quantity: 1 }] },
    {
      addressId,
      items: [
        { orderItemId: itemA, quantity: 35 },
        { orderItemId: itemB, quantity: 36 },
      ],
    },
    {
      addressId,
      items: [
        { orderItemId: itemA, quantity: 1 },
        { orderItemId: itemA.toUpperCase(), quantity: 1 },
      ],
    },
    { ...selection(), cpf: "not permitted" },
    {
      addressId,
      items: [{ orderItemId: itemA, quantity: 1, cardName: "not persisted" }],
    },
    {
      addressId,
      items: Array.from({ length: 101 }, () => ({
        orderItemId: itemA,
        quantity: 1,
      })),
    },
  ])("rejects invalid selections without saving: %j", (input) => {
    expect(() => ensureShipmentAttempt("customer", input)).toThrow("1 a 70");
    expect(sessionStorage.length).toBe(0);
    expect(crypto.randomUUID).not.toHaveBeenCalled();
  });

  it.each([
    "{",
    "null",
    "[]",
    JSON.stringify({ key: "bad", input: selection() }),
    JSON.stringify({ key: key.replace("46ab", "36ab"), input: selection() }),
    JSON.stringify({ key, input: selection(71) }),
    JSON.stringify({
      key,
      input: { ...selection(), recipientName: "private" },
    }),
    JSON.stringify({ key, input: selection(), accessToken: "not permitted" }),
  ])("fails closed on corrupted stored data: %s", (raw) => {
    ensureShipmentAttempt("customer", selection());
    const storageKey = sessionStorage.key(0)!;
    sessionStorage.setItem(storageKey, raw);
    vi.mocked(crypto.randomUUID).mockClear();
    expect(() => loadShipmentAttempt("customer")).toThrow(
      "Consulte seus envios",
    );
    expect(() => ensureShipmentAttempt("customer", selection())).toThrow(
      "Consulte seus envios",
    );
    expect(sessionStorage.getItem(storageKey)).toBe(raw);
    expect(crypto.randomUUID).not.toHaveBeenCalled();
  });

  it("stops before preparing a request when storage is unavailable", () => {
    vi.stubGlobal("sessionStorage", undefined);
    expect(() => ensureShipmentAttempt("customer", selection())).toThrow(
      "Permita o armazenamento",
    );
    expect(crypto.randomUUID).not.toHaveBeenCalled();
  });

  it("stops before preparing a request when storage reads fail", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    expect(() => ensureShipmentAttempt("customer", selection())).toThrow(
      "Permita o armazenamento",
    );
    expect(crypto.randomUUID).not.toHaveBeenCalled();
  });

  it("does not return an unsaved request when storage writes fail", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Full", "QuotaExceededError");
    });
    expect(() => ensureShipmentAttempt("customer", selection())).toThrow(
      "Permita o armazenamento",
    );
    expect(loadShipmentAttempt("customer")).toBeNull();
  });

  it("requires readable persistence even if the storage setter silently does nothing", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {});
    expect(() => ensureShipmentAttempt("customer", selection())).toThrow(
      "Permita o armazenamento",
    );
    expect(loadShipmentAttempt("customer")).toBeNull();
  });

  it("does not clear a newer request when an older result arrives late", () => {
    const first = ensureShipmentAttempt("customer", selection(1));
    forgetShipmentAttempt("customer", first.key);
    vi.mocked(crypto.randomUUID).mockReturnValueOnce(otherKey);
    const second = ensureShipmentAttempt("customer", selection(2));
    forgetShipmentAttempt("customer", first.key);
    expect(loadShipmentAttempt("customer")).toEqual(second);
    forgetShipmentAttempt("customer", second.key);
    expect(loadShipmentAttempt("customer")).toBeNull();
  });

  it("preserves a recoverable request if removing storage fails", () => {
    const saved = ensureShipmentAttempt("customer", selection());
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("Blocked");
    });
    expect(() => forgetShipmentAttempt("customer", saved.key)).not.toThrow();
    expect(loadShipmentAttempt("customer")).toEqual(saved);
  });
});
