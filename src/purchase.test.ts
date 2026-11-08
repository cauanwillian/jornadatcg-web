// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureAttempt, forgetAttempt, loadAttempt } from "./purchase";

const key = "68a7b7af-18a9-46ab-b44d-a7438cbb5c02";
const otherKey = "893a8f02-6d64-4c12-9f13-70c26314c11b";

beforeEach(() => {
  sessionStorage.clear();
  vi.spyOn(crypto, "randomUUID").mockReturnValue(key);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Checkout recovery", () => {
  it("persists the request before returning and reuses it after a total change", () => {
    expect(loadAttempt("customer")).toBeNull();
    expect(ensureAttempt("customer", "10.00")).toEqual({
      key,
      expectedSubtotal: "10.00",
    });
    expect(ensureAttempt("customer", "12.50")).toEqual({
      key,
      expectedSubtotal: "10.00",
    });
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sessionStorage.getItem(sessionStorage.key(0)!)!)).toEqual(
      {
        key,
        expectedSubtotal: "10.00",
      },
    );
  });

  it("isolates attempts by user", () => {
    ensureAttempt("first", "10.00");
    vi.mocked(crypto.randomUUID).mockReturnValueOnce(otherKey);
    expect(loadAttempt("second")).toBeNull();
    ensureAttempt("second", "20.00");
    expect(loadAttempt("first")).toEqual({ key, expectedSubtotal: "10.00" });
    expect(loadAttempt("second")).toEqual({
      key: otherKey,
      expectedSubtotal: "20.00",
    });
  });

  it("recovers an attempt after the client module reloads", async () => {
    ensureAttempt("customer", "10.00");
    vi.resetModules();
    const reloaded = await import("./purchase");
    expect(reloaded.ensureAttempt("customer", "30.00")).toEqual({
      key,
      expectedSubtotal: "10.00",
    });
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
  });

  it.each([
    "{",
    "null",
    "[]",
    JSON.stringify({ key: "not-a-uuid", expectedSubtotal: "10.00" }),
    JSON.stringify({
      key: key.replace("46ab", "36ab"),
      expectedSubtotal: "10.00",
    }),
    JSON.stringify({ key, expectedSubtotal: "0.00" }),
    JSON.stringify({ key, expectedSubtotal: 10 }),
    JSON.stringify({ key, expectedSubtotal: "10.0" }),
    JSON.stringify({ key, expectedSubtotal: "10000000000.00" }),
    JSON.stringify({ key, expectedSubtotal: "10.00", cpf: "unexpected" }),
  ])("refuses to replace a corrupt saved attempt: %s", (raw) => {
    ensureAttempt("customer", "10.00");
    const storageKey = sessionStorage.key(0)!;
    sessionStorage.setItem(storageKey, raw);
    vi.mocked(crypto.randomUUID).mockClear();
    expect(() => loadAttempt("customer")).toThrow("Consulte seus pedidos");
    expect(() => ensureAttempt("customer", "10.00")).toThrow(
      "Consulte seus pedidos",
    );
    expect(sessionStorage.getItem(storageKey)).toBe(raw);
    expect(crypto.randomUUID).not.toHaveBeenCalled();
  });

  it("stops before preparing a purchase when session storage is missing", () => {
    vi.stubGlobal("sessionStorage", undefined);
    expect(() => ensureAttempt("customer", "10.00")).toThrow(
      "Permita o armazenamento",
    );
    expect(crypto.randomUUID).not.toHaveBeenCalled();
  });

  it("stops before preparing a purchase when storage cannot be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    expect(() => ensureAttempt("customer", "10.00")).toThrow(
      "Permita o armazenamento",
    );
    expect(crypto.randomUUID).not.toHaveBeenCalled();
  });

  it("does not return an unsaved request when storage cannot be written", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Full", "QuotaExceededError");
    });
    expect(() => ensureAttempt("customer", "10.00")).toThrow(
      "Permita o armazenamento",
    );
    expect(loadAttempt("customer")).toBeNull();
  });

  it.each(["0.00", "-1.00", "10", "01.00", "10.001", "NaN"])(
    "rejects invalid new purchase total %s",
    (amount) => {
      expect(() => ensureAttempt("customer", amount)).toThrow("Revise o total");
      expect(crypto.randomUUID).not.toHaveBeenCalled();
      expect(sessionStorage.length).toBe(0);
    },
  );

  it("forgets only the selected user's completed attempt", () => {
    ensureAttempt("first", "10.00");
    vi.mocked(crypto.randomUUID).mockReturnValueOnce(otherKey);
    ensureAttempt("second", "20.00");
    forgetAttempt("first", key);
    expect(loadAttempt("first")).toBeNull();
    expect(loadAttempt("second")).toEqual({
      key: otherKey,
      expectedSubtotal: "20.00",
    });
  });

  it("keeps a completed attempt recoverable when removal fails", () => {
    ensureAttempt("customer", "10.00");
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    expect(() => forgetAttempt("customer", key)).not.toThrow();
    expect(loadAttempt("customer")).toEqual({ key, expectedSubtotal: "10.00" });
  });

  it("does not remove a newer purchase when an older response arrives late", () => {
    const first = ensureAttempt("customer", "10.00");
    forgetAttempt("customer", first.key);
    vi.mocked(crypto.randomUUID).mockReturnValueOnce(otherKey);
    const second = ensureAttempt("customer", "20.00");

    forgetAttempt("customer", first.key);

    expect(loadAttempt("customer")).toEqual(second);
    expect(second).toEqual({ key: otherKey, expectedSubtotal: "20.00" });
    forgetAttempt("customer", second.key);
    expect(loadAttempt("customer")).toBeNull();
  });
});
