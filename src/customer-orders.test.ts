// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authorized } from "./session";
import {
  canCancelOrder,
  cancelCustomerOrder,
  fetchCustomerOrders,
  inspectOrderCancellation,
  orderActionError,
} from "./customer-orders";
import type { OrderPayment } from "./customer-orders";
import type { Order } from "./purchase";

vi.mock("./session", () => ({ authorized: vi.fn() }));
const id = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const stamp = "2026-10-26T12:00:00.000Z";
const controller = () => new AbortController();
const order = (changes: Partial<Order> = {}): Order => ({
  id,
  orderNumber: 18,
  status: "PENDING_PAYMENT",
  subtotal: "10.00",
  shippingAmount: "0.00",
  discountAmount: "0.00",
  total: "10.00",
  createdAt: stamp,
  updatedAt: stamp,
  paidAt: null,
  expiresAt: "2026-10-26T12:15:00.000Z",
  cancelledAt: null,
  items: [
    {
      id: "item-one",
      productId: "product-one",
      cardName: "Pikachu",
      cardNumber: "025",
      setName: "Coleção de teste",
      conditionName: "Near Mint",
      languageName: "Português",
      categoryName: "Cartas avulsas",
      quantity: 1,
      unitPrice: "10.00",
      totalPrice: "10.00",
    },
  ],
  ...changes,
});
const payment = (changes: Partial<OrderPayment> = {}): OrderPayment => ({
  id: "payment-one",
  orderId: id,
  shipmentId: null,
  provider: "asaas:sandbox",
  method: "PIX",
  status: "FAILED",
  amount: "10.00",
  installments: 1,
  createdAt: stamp,
  updatedAt: stamp,
  paidAt: null,
  failedAt: stamp,
  expiresAt: null,
  ...changes,
});
function review(detail: unknown = order(), history: unknown = []) {
  vi.mocked(authorized).mockImplementation(async (path) => {
    if (path === `/orders/${id}`) return detail;
    if (path === `/orders/${id}/payments`) return history;
    throw new Error("UNEXPECTED_SECRET_REQUEST");
  });
}
beforeEach(() => {
  vi.mocked(authorized).mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Customer order cancellation eligibility", () => {
  it("permits a pending order with an empty authoritative payment history", () =>
    expect(canCancelOrder(order(), [])).toBe(true));
  it.each(["FAILED", "EXPIRED", "CANCELLED"] as const)(
    "permits historical %s payments",
    (status) =>
      expect(canCancelOrder(order(), [payment({ status })])).toBe(true),
  );
  it.each(["PIX", "CREDIT_CARD", "DEBIT_CARD", "BOLETO"] as const)(
    "blocks active %s payments",
    (method) => {
      for (const status of ["PENDING", "PAID", "REFUNDED"] as const)
        expect(canCancelOrder(order(), [payment({ method, status })])).toBe(
          false,
        );
    },
  );
  it("checks every payment, including an older active payment from another provider", () =>
    expect(
      canCancelOrder(order(), [
        payment({ id: "latest", status: "FAILED" }),
        payment({
          id: "older",
          status: "PENDING",
          provider: "another-provider",
        }),
      ]),
    ).toBe(false));
  it.each([
    "PAID",
    "PREPARING",
    "READY_TO_SHIP",
    "SHIPPED",
    "DELIVERED",
    "CANCELLED",
  ] as const)("does not offer cancellation for a %s order", (status) =>
    expect(canCancelOrder(order({ status }), [])).toBe(false),
  );
  it("does not infer cancellation or payment expiry from the browser clock", () => {
    const expired = order({ expiresAt: "2000-01-01T00:00:00.000Z" });
    expect(canCancelOrder(expired, [])).toBe(true);
    expect(
      canCancelOrder(expired, [
        payment({ status: "PENDING", expiresAt: "2000-01-01T00:00:00.000Z" }),
      ]),
    ).toBe(false);
    expect(canCancelOrder(order({ expiresAt: null }), [])).toBe(true);
  });
  it("conservatively rejects a mismatched or unknown payment when called directly", () => {
    expect(canCancelOrder(order(), [payment({ orderId: otherId })])).toBe(
      false,
    );
    expect(canCancelOrder(order(), [payment({ shipmentId: otherId })])).toBe(
      false,
    );
    expect(
      canCancelOrder(order(), [
        payment({ status: "UNKNOWN" as OrderPayment["status"] }),
      ]),
    ).toBe(false);
    expect(
      canCancelOrder(order(), [
        payment({ method: "CASH" as OrderPayment["method"] }),
      ]),
    ).toBe(false);
    expect(canCancelOrder(order(), null as unknown as OrderPayment[])).toBe(
      false,
    );
  });
});

describe("Authoritative customer order reads", () => {
  it("loads only the requested history page with no-store", async () => {
    const result = { items: [order()], page: 1, pageSize: 20, total: 1 };
    vi.mocked(authorized).mockResolvedValue(result);
    const cancel = controller();
    expect(await fetchCustomerOrders(1, cancel)).toEqual(result);
    expect(authorized).toHaveBeenCalledExactlyOnceWith(
      "/orders?page=1&pageSize=20",
      { method: "GET", signal: cancel.signal, cache: "no-store" },
    );
  });
  it("accepts an empty first page and an empty page beyond the last page", async () => {
    vi.mocked(authorized)
      .mockResolvedValueOnce({ items: [], page: 1, pageSize: 20, total: 0 })
      .mockResolvedValueOnce({ items: [], page: 2, pageSize: 20, total: 1 });
    expect(await fetchCustomerOrders(1, controller())).toEqual({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    });
    expect((await fetchCustomerOrders(2, controller())).items).toEqual([]);
  });
  it.each([0, -1, 1.5, 1_000_001, NaN, Infinity, "1" as unknown as number])(
    "rejects invalid page %s before sending a request",
    async (page) => {
      await expect(
        fetchCustomerOrders(page, controller()),
      ).rejects.toMatchObject({ status: 400 });
      expect(authorized).not.toHaveBeenCalled();
    },
  );
  it.each([
    { items: [], page: 2, pageSize: 20, total: 0 },
    { items: [], page: 1, pageSize: 10, total: 0 },
    { items: [], page: 1, pageSize: 20, total: 1 },
    { items: [order()], page: 1, pageSize: 20, total: 0 },
    { items: [], page: 1, pageSize: 20, total: -1 },
    { items: [], page: 1, pageSize: 20, total: "0" },
    { items: [order(), order()], page: 1, pageSize: 20, total: 2 },
    [],
    null,
  ])("rejects malformed or inconsistent order pages", async (value) => {
    vi.mocked(authorized).mockResolvedValue(value);
    await expect(fetchCustomerOrders(1, controller())).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
  it("reads the fresh order and all payment methods without consulting Pix or a provider", async () => {
    const payments = [payment({ method: "BOLETO" })];
    review(order(), payments);
    const cancel = controller();
    expect(await inspectOrderCancellation(id, cancel)).toEqual({
      order: order(),
      payments,
      canCancel: true,
    });
    expect(authorized).toHaveBeenCalledTimes(2);
    expect(authorized).toHaveBeenCalledWith(`/orders/${id}`, {
      method: "GET",
      signal: cancel.signal,
      cache: "no-store",
    });
    expect(authorized).toHaveBeenCalledWith(`/orders/${id}/payments`, {
      method: "GET",
      signal: cancel.signal,
      cache: "no-store",
    });
  });
  it("normalizes only documented fields and strips internal fields from orders, items and payments", async () => {
    const base = order();
    review(
      {
        ...base,
        secret: "secret",
        items: [{ ...base.items[0], providerToken: "secret" }],
      },
      [{ ...payment(), internal: "secret" }],
    );
    const result = await inspectOrderCancellation(id, controller());
    expect(result).toEqual({
      order: base,
      payments: [payment()],
      canCancel: true,
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });
  it("preserves deleted-product snapshots and all monetary and date fields", async () => {
    const base = order({ items: [{ ...order().items[0], productId: null }] });
    review(base, []);
    expect((await inspectOrderCancellation(id, controller())).order).toEqual(
      base,
    );
  });
  it.each(["PENDING", "PAID", "REFUNDED"] as const)(
    "marks a fresh %s payment as ineligible",
    async (status) => {
      review(order(), [payment({ status })]);
      expect((await inspectOrderCancellation(id, controller())).canCancel).toBe(
        false,
      );
    },
  );
  it("does not invent an arbitrary maximum history length", async () => {
    const history = Array.from({ length: 301 }, (_, index) =>
      payment({ id: `payment-${index}` }),
    );
    review(order(), history);
    const result = await inspectOrderCancellation(id, controller());
    expect(result.payments).toHaveLength(301);
    expect(result.canCancel).toBe(true);
  });
  it.each([
    { ...order(), id: otherId },
    { ...order(), status: "UNKNOWN" },
    { ...order(), id: "not-a-uuid" },
    { ...order(), orderNumber: 0 },
    { ...order(), subtotal: 10 },
    { ...order(), total: "10.123" },
    { ...order(), total: "-10.00" },
    { ...order(), updatedAt: "not-a-date" },
    { ...order(), paidAt: undefined },
    { ...order(), expiresAt: "invalid" },
    { ...order(), items: [] },
    { ...order(), items: [{ ...order().items[0], quantity: 0 }] },
    { ...order(), items: [{ ...order().items[0], totalPrice: "NaN" }] },
    { ...order(), items: [order().items[0], order().items[0]] },
  ])(
    "blocks confirmation for malformed or mismatched order detail",
    async (detail) => {
      review(detail, []);
      await expect(
        inspectOrderCancellation(id, controller()),
      ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    },
  );
  it.each([
    null,
    {},
    { items: [] },
    [payment({ orderId: otherId })],
    [payment({ orderId: null })],
    [payment({ shipmentId: otherId })],
    [payment({ status: "UNKNOWN" as OrderPayment["status"] })],
    [payment({ method: "CASH" as OrderPayment["method"] })],
    [payment({ amount: "NaN" })],
    [payment({ installments: 0 })],
    [{ ...payment(), updatedAt: "invalid" }],
    [{ ...payment(), failedAt: undefined }],
    [payment(), payment()],
  ])(
    "blocks confirmation for malformed, mismatched or duplicate payment history",
    async (history) => {
      review(order(), history);
      await expect(
        inspectOrderCancellation(id, controller()),
      ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    },
  );
  it("does not treat a failed history request as an empty history", async () => {
    vi.mocked(authorized).mockImplementation(async (path) => {
      if (path === `/orders/${id}`) return order();
      throw Object.assign(new Error("SECRET_DATABASE_FAILURE"), {
        status: 503,
      });
    });
    await expect(
      inspectOrderCancellation(id, controller()),
    ).rejects.toMatchObject({ status: 503 });
    expect(authorized).toHaveBeenCalledTimes(2);
  });
});

describe("Explicit order cancellation", () => {
  it("sends one bodyless POST and accepts only the authoritative cancelled order", async () => {
    const cancelled = order({ status: "CANCELLED", cancelledAt: stamp });
    vi.mocked(authorized).mockResolvedValue(cancelled);
    const cancel = controller();
    expect(await cancelCustomerOrder(id, cancel)).toEqual(cancelled);
    expect(authorized).toHaveBeenCalledExactlyOnceWith(`/orders/${id}/cancel`, {
      method: "POST",
      signal: cancel.signal,
      cache: "no-store",
    });
  });
  it("permits an explicit replay to return the same cancelled order", async () => {
    const cancelled = order({ status: "CANCELLED", cancelledAt: stamp });
    vi.mocked(authorized).mockResolvedValue(cancelled);
    expect(await cancelCustomerOrder(id, controller())).toEqual(cancelled);
    expect(await cancelCustomerOrder(id, controller())).toEqual(cancelled);
    expect(authorized).toHaveBeenCalledTimes(2);
  });
  it.each([
    "PENDING_PAYMENT",
    "PAID",
    "PREPARING",
    "READY_TO_SHIP",
    "SHIPPED",
    "DELIVERED",
  ] as const)("never reports success for a %s response", async (status) => {
    vi.mocked(authorized).mockResolvedValue(order({ status }));
    await expect(cancelCustomerOrder(id, controller())).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
    expect(authorized).toHaveBeenCalledTimes(1);
  });
  it("rejects a cancelled response for another order", async () => {
    vi.mocked(authorized).mockResolvedValue(
      order({ id: otherId, status: "CANCELLED", cancelledAt: stamp }),
    );
    await expect(cancelCustomerOrder(id, controller())).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
  it.each([400, 401, 403, 404, 409, 429, 503])(
    "never retries HTTP %s or exposes its internal message",
    async (status) => {
      vi.mocked(authorized).mockRejectedValue(
        Object.assign(new Error("SECRET_PROVIDER_KEY"), {
          status,
          secret: "secret",
        }),
      );
      const caught = await cancelCustomerOrder(id, controller()).catch(
        (error) => error,
      );
      expect(caught).toMatchObject({ status });
      expect(caught.message).not.toContain("SECRET");
      expect(caught).not.toHaveProperty("secret");
      expect(authorized).toHaveBeenCalledTimes(1);
    },
  );
  it("never retries a lost response", async () => {
    vi.mocked(authorized).mockRejectedValue(new Error("SECRET_SOCKET_ERROR"));
    const caught = await cancelCustomerOrder(id, controller()).catch(
      (error) => error,
    );
    expect(caught.message).not.toContain("SECRET");
    expect(orderActionError(caught, "cancel")).toContain(
      "pode ter sido concluído",
    );
    expect(authorized).toHaveBeenCalledTimes(1);
  });
  it.each(["not-a-uuid", "../other", "", `${id}/cancel`])(
    "rejects invalid order identifier %s without requests",
    async (invalidId) => {
      await expect(
        cancelCustomerOrder(invalidId, controller()),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        inspectOrderCancellation(invalidId, controller()),
      ).rejects.toMatchObject({ status: 400 });
      expect(authorized).not.toHaveBeenCalled();
    },
  );
});

describe("Deadlines, interruption and safe error messages", () => {
  it("shares a single 15-second deadline across the detail and history reads", async () => {
    vi.useFakeTimers();
    vi.mocked(authorized).mockImplementation((path) =>
      path.endsWith("/payments")
        ? new Promise(() => {})
        : new Promise((resolve) => setTimeout(() => resolve(order()), 10_000)),
    );
    const cancel = controller();
    const promise = inspectOrderCancellation(id, cancel);
    const rejected = expect(promise).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(15_000);
    await rejected;
    expect(cancel.signal.aborted).toBe(true);
    expect(authorized).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("bounds a POST even if a mock transport ignores cancellation, without retrying", async () => {
    vi.useFakeTimers();
    vi.mocked(authorized).mockImplementation(() => new Promise(() => {}));
    const cancel = controller();
    const rejected = expect(
      cancelCustomerOrder(id, cancel),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(15_000);
    await rejected;
    expect(authorized).toHaveBeenCalledTimes(1);
    expect(cancel.signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("stops an interrupted read and removes its listener and timeout", async () => {
    vi.useFakeTimers();
    vi.mocked(authorized).mockImplementation(() => new Promise(() => {}));
    const cancel = controller();
    const remove = vi.spyOn(cancel.signal, "removeEventListener");
    const rejected = expect(
      fetchCustomerOrders(1, cancel),
    ).rejects.toMatchObject({ code: "ABORTED" });
    cancel.abort();
    await rejected;
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });
  it("sends nothing when already interrupted", async () => {
    const cancel = controller();
    cancel.abort();
    await expect(cancelCustomerOrder(id, cancel)).rejects.toMatchObject({
      code: "ABORTED",
    });
    expect(authorized).not.toHaveBeenCalled();
  });
  it("cleans up a successful request's timeout and abort listener", async () => {
    vi.useFakeTimers();
    const cancel = controller();
    const remove = vi.spyOn(cancel.signal, "removeEventListener");
    vi.mocked(authorized).mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    });
    await fetchCustomerOrders(1, cancel);
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });
  it.each(["list", "review", "cancel"] as const)(
    "never displays raw errors in %s messages",
    (action) => {
      for (const status of [undefined, 400, 401, 403, 404, 409, 429, 500, 503])
        expect(
          orderActionError(
            { message: "SECRET_DATABASE_PASSWORD", status },
            action,
          ),
        ).not.toContain("SECRET");
    },
  );
  it("keeps ambiguous cancellation guidance for malformed, timeout and server errors", () => {
    for (const error of [
      { code: "INVALID_RESPONSE" },
      { code: "TIMEOUT" },
      { status: 503 },
      { status: 504 },
      new Error("secret"),
    ]) {
      const message = orderActionError(error, "cancel");
      expect(message).toContain("pode ter sido concluído");
      expect(message).toContain("Consulte");
    }
  });
});
