// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authorized } from "./session";
import {
  adminOrderError,
  fetchAdminOrder,
  fetchAdminOrders,
  salesMoney,
  validateAdminOrderFilters,
} from "./admin-orders";
import type {
  AdminOrderDetail,
  AdminOrderFilterDraft,
  AdminOrdersPage,
} from "./admin-orders";

vi.mock("./session", () => ({ authorized: vi.fn() }));
const id = "11111111-1111-4111-8111-111111111111";
const customerId = "22222222-2222-4222-8222-222222222222";
const shipmentId = "33333333-3333-4333-8333-333333333333";
const otherId = "44444444-4444-4444-8444-444444444444";
const time = "2026-11-04T12:00:00.000Z";
const controller = () => new AbortController();
const draft = (
  changes: Partial<AdminOrderFilterDraft> = {},
): AdminOrderFilterDraft => ({
  status: "",
  orderNumber: "",
  customer: "",
  from: "",
  to: "",
  ...changes,
});
const customer = () => ({
  id: customerId,
  name: "Cliente de demonstração",
  email: "demo@example.com",
});
const page = (): AdminOrdersPage => ({
  items: [
    {
      id,
      orderNumber: 18,
      status: "PAID",
      total: "20.00",
      createdAt: time,
      paidAt: time,
      cancelledAt: null,
      customer: customer(),
      quantity: 2,
    },
  ],
  page: 1,
  pageSize: 20,
  total: 1,
  summary: {
    orderCount: 1,
    pendingCount: 0,
    confirmedCount: 1,
    confirmedAmount: "20.00",
  },
});
const detail = (): AdminOrderDetail => ({
  order: {
    id,
    orderNumber: 18,
    status: "PAID",
    subtotal: "20.00",
    shippingAmount: "0.00",
    discountAmount: "0.00",
    total: "20.00",
    createdAt: time,
    updatedAt: time,
    paidAt: time,
    expiresAt: null,
    cancelledAt: null,
    items: [
      {
        id: "item-1",
        productId: null,
        cardName: "Pikachu",
        cardNumber: "025",
        setName: "Coleção de demonstração",
        conditionName: "Near Mint",
        languageName: "Português",
        categoryName: null,
        quantity: 2,
        unitPrice: "10.00",
        totalPrice: "20.00",
      },
    ],
  },
  customer: customer(),
  payments: [
    {
      id: "payment-1",
      orderId: id,
      shipmentId: null,
      provider: "asaas:sandbox",
      method: "PIX",
      status: "PAID",
      amount: "20.00",
      installments: 1,
      createdAt: time,
      updatedAt: time,
      paidAt: time,
      failedAt: null,
      expiresAt: null,
    },
  ],
  shipments: [
    {
      id: shipmentId,
      status: "PREPARING",
      requestedAt: time,
      shippedAt: null,
      deliveredAt: null,
      trackingCode: null,
      shippingCost: "12.68",
      shippingPaidAt: time,
      items: [{ orderItemId: "item-1", quantity: 1 }],
    },
  ],
});
beforeEach(() => {
  vi.mocked(authorized).mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Administrative order filters", () => {
  it("supports all orders without filters and trims a customer query", () => {
    expect(validateAdminOrderFilters(draft())).toEqual({
      query: {},
      errors: {},
    });
    expect(
      validateAdminOrderFilters(
        draft({
          status: "PAID",
          orderNumber: " 18 ",
          customer: " Cauan _% ",
          from: "2026-11-04",
          to: "2026-11-04",
        }),
      ),
    ).toEqual({
      query: {
        status: "PAID",
        orderNumber: "18",
        customer: "Cauan _%",
        from: new Date("2026-11-04T00:00:00").toISOString(),
        to: new Date("2026-11-05T00:00:00").toISOString(),
      },
      errors: {},
    });
  });
  it("makes the final day inclusive by advancing a calendar day before UTC conversion", () => {
    expect(
      validateAdminOrderFilters(draft({ to: "2026-12-31" })).query?.to,
    ).toBe(new Date("2027-01-01T00:00:00").toISOString());
    expect(
      validateAdminOrderFilters(draft({ to: "2024-02-29" })).query?.to,
    ).toBe(new Date("2024-03-01T00:00:00").toISOString());
  });
  it.each([
    ["America/Santiago", "2026-09-06", "2026-09-07T03:00:00.000Z"],
    ["America/Cuiaba", "2018-11-04", "2018-11-05T03:00:00.000Z"],
  ])(
    "ends at the next midnight after a midnight DST gap in %s",
    (zone, to, expected) => {
      vi.stubEnv("TZ", zone);
      try {
        expect(new Date(`${to}T00:00:00`).getHours()).toBe(1);
        expect(validateAdminOrderFilters(draft({ to })).query?.to).toBe(
          expected,
        );
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );
  it("accepts either date boundary independently and omits a blank customer", () => {
    expect(
      validateAdminOrderFilters(draft({ from: "2026-01-01", customer: "  " }))
        .query,
    ).toEqual({ from: new Date("2026-01-01T00:00:00").toISOString() });
    expect(
      validateAdminOrderFilters(draft({ to: "2026-01-01" })).query,
    ).toEqual({ to: new Date("2026-01-02T00:00:00").toISOString() });
  });
  it.each(["UNKNOWN", "paid", " PAID "])(
    "rejects unknown order status %s",
    (status) =>
      expect(
        validateAdminOrderFilters(draft({ status })).errors.status,
      ).toBeTruthy(),
  );
  it.each(["0", "01", "-1", "1.2", "1e2", "2147483648", "9007199254740993"])(
    "rejects invalid order number %s",
    (orderNumber) =>
      expect(
        validateAdminOrderFilters(draft({ orderNumber })).errors.orderNumber,
      ).toBeTruthy(),
  );
  it.each([
    "2026-02-29",
    "2026-02-31",
    "2026-13-01",
    "2026-00-01",
    "2026-01-00",
    "04/11/2026",
    "2026-1-1",
  ])("rejects an invalid calendar date %s", (from) =>
    expect(validateAdminOrderFilters(draft({ from })).errors.from).toBeTruthy(),
  );
  it("rejects a reversed range and a final date that cannot yield a four-digit next day", () => {
    expect(
      validateAdminOrderFilters(draft({ from: "2026-11-05", to: "2026-11-04" }))
        .errors.to,
    ).toBeTruthy();
    expect(
      validateAdminOrderFilters(draft({ to: "9999-12-31" })).errors.to,
    ).toBeTruthy();
  });
  it.each([
    "a".repeat(201),
    "Nome\nprivado",
    "Nome\u0000privado",
    "Nome\u007f",
  ])("rejects invalid customer text", (customer) =>
    expect(
      validateAdminOrderFilters(draft({ customer })).errors.customer,
    ).toBeTruthy(),
  );
});

describe("Administrative list requests and normalization", () => {
  it("uses only the read-only admin endpoint and normalized, URL-encoded filters", async () => {
    vi.mocked(authorized).mockResolvedValue(page());
    const abort = controller();
    const result = await fetchAdminOrders(
      { status: "PAID", orderNumber: "18", customer: "Nome & Pessoa" },
      1,
      abort,
    );
    const [path, options] = vi.mocked(authorized).mock.calls[0];
    const url = new URL(path, "https://api.example.com");
    expect(url.pathname).toBe("/admin/orders");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      page: "1",
      pageSize: "20",
      status: "PAID",
      orderNumber: "18",
      customer: "Nome & Pessoa",
    });
    expect(options).toEqual({
      method: "GET",
      signal: abort.signal,
      cache: "no-store",
    });
    expect(result).toEqual(page());
  });
  it("keeps full-filter summary independent from a single page and preserves aggregate cents", async () => {
    vi.mocked(authorized).mockResolvedValue({
      ...page(),
      page: 2,
      total: 21,
      summary: {
        orderCount: 21,
        pendingCount: 1,
        confirmedCount: 20,
        confirmedAmount: "9007199254740993.01",
      },
    });
    const result = await fetchAdminOrders({}, 2, controller());
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(21);
    expect(result.summary.confirmedAmount).toBe("9007199254740993.01");
  });
  it("normalizes an empty result and zero summary", async () => {
    vi.mocked(authorized).mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
      summary: {
        orderCount: 0,
        pendingCount: 0,
        confirmedCount: 0,
        confirmedAmount: "0.00",
      },
    });
    expect((await fetchAdminOrders({}, 1, controller())).items).toEqual([]);
  });
  it("strips internal and personal fields outside the approved DTO", async () => {
    vi.mocked(authorized).mockResolvedValue({
      ...page(),
      checkoutKey: "SECRET",
      items: page().items.map((row) => ({
        ...row,
        providerCustomerId: "SECRET",
        customer: {
          ...row.customer,
          cpf: "SECRET",
          passwordHash: "SECRET",
          authVersion: 4,
        },
      })),
      summary: { ...page().summary, private: "SECRET" },
    });
    expect(
      JSON.stringify(await fetchAdminOrders({}, 1, controller())),
    ).not.toContain("SECRET");
  });
  it.each([0, -1, 1.5, 1_000_001, NaN, Infinity])(
    "rejects page %s before HTTP",
    async (value) => {
      await expect(
        fetchAdminOrders({}, value, controller()),
      ).rejects.toMatchObject({ status: 400 });
      expect(authorized).not.toHaveBeenCalled();
    },
  );
  it.each([
    { status: "UNKNOWN" },
    { orderNumber: "0" },
    { orderNumber: "2147483648" },
    { customer: "" },
    { customer: "A\nB" },
    { from: "2026-02-31T00:00:00.000Z" },
    { to: "not-a-date" },
    { from: time, to: time },
    { role: "ADMIN" },
  ])("rejects malformed normalized filters %j before HTTP", async (filters) => {
    await expect(
      fetchAdminOrders(filters as never, 1, controller()),
    ).rejects.toMatchObject({ status: 400 });
    expect(authorized).not.toHaveBeenCalled();
  });
  it.each([
    (value: AdminOrdersPage) => ({ ...value, page: 2 }),
    (value: AdminOrdersPage) => ({ ...value, pageSize: 100 }),
    (value: AdminOrdersPage) => ({ ...value, total: 2 }),
    (value: AdminOrdersPage) => ({
      ...value,
      summary: { ...value.summary, orderCount: 2 },
    }),
    (value: AdminOrdersPage) => ({
      ...value,
      summary: { ...value.summary, pendingCount: 1 },
    }),
    (value: AdminOrdersPage) => ({
      ...value,
      summary: { ...value.summary, confirmedAmount: 20 },
    }),
    (value: AdminOrdersPage) => ({
      ...value,
      items: [{ ...value.items[0], quantity: 0 }],
    }),
    (value: AdminOrdersPage) => ({
      ...value,
      items: [{ ...value.items[0], total: "20,00" }],
    }),
    (value: AdminOrdersPage) => ({
      ...value,
      items: [{ ...value.items[0], id: "not-a-uuid" }],
    }),
    (value: AdminOrdersPage) => ({
      ...value,
      items: [{ ...value.items[0], createdAt: "2026-02-31T12:00:00.000Z" }],
    }),
  ])("rejects incoherent list data", async (change) => {
    vi.mocked(authorized).mockResolvedValue(change(page()));
    await expect(fetchAdminOrders({}, 1, controller())).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
  it("rejects duplicate IDs across a single page", async () => {
    vi.mocked(authorized).mockResolvedValue({
      ...page(),
      items: [page().items[0], page().items[0]],
      total: 2,
      summary: {
        orderCount: 2,
        pendingCount: 0,
        confirmedCount: 2,
        confirmedAmount: "40.00",
      },
    });
    await expect(fetchAdminOrders({}, 1, controller())).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
});

describe("Administrative order detail", () => {
  it("uses the admin UUID endpoint and allows a nullable historical category", async () => {
    vi.mocked(authorized).mockResolvedValue(detail());
    expect(await fetchAdminOrder(id, controller())).toEqual(detail());
    expect(authorized).toHaveBeenCalledWith(
      `/admin/orders/${id}`,
      expect.objectContaining({ method: "GET", cache: "no-store" }),
    );
  });
  it("does not expose provider identifiers, raw data or unrelated profile fields", async () => {
    const value = detail();
    vi.mocked(authorized).mockResolvedValue({
      ...value,
      providerResponse: "SECRET",
      order: {
        ...value.order,
        checkoutKey: "SECRET",
        user: { passwordHash: "SECRET" },
      },
      customer: { ...value.customer, phone: "SECRET" },
      payments: value.payments.map((payment) => ({
        ...payment,
        providerPaymentId: "SECRET",
        providerCustomerId: "SECRET",
      })),
      shipments: value.shipments.map((shipment) => ({
        ...shipment,
        shippingAddress: "SECRET",
        items: shipment.items.map((item) => ({ ...item, private: "SECRET" })),
      })),
    });
    expect(
      JSON.stringify(await fetchAdminOrder(id, controller())),
    ).not.toContain("SECRET");
  });
  it.each([
    "ACCUMULATING",
    "PENDING",
    "PREPARING",
    "READY_TO_SHIP",
    "SHIPPED",
    "DELIVERED",
    "CANCELLED",
  ] as const)("supports shipment status %s", async (status) => {
    const value = detail();
    value.shipments[0].status = status;
    vi.mocked(authorized).mockResolvedValue(value);
    expect((await fetchAdminOrder(id, controller())).shipments[0].status).toBe(
      status,
    );
  });
  it("retains cancelled and new shipping allocations without applying an invalid historical aggregate cap", async () => {
    const value = detail();
    value.shipments[0].items[0].quantity = 2;
    value.shipments.push({
      ...value.shipments[0],
      id: otherId,
      status: "CANCELLED",
      items: [{ orderItemId: "item-1", quantity: 2 }],
    });
    vi.mocked(authorized).mockResolvedValue(value);
    expect((await fetchAdminOrder(id, controller())).shipments).toHaveLength(2);
  });
  it("supports deleted products, no payments and no shipping requests", async () => {
    vi.mocked(authorized).mockResolvedValue({
      ...detail(),
      payments: [],
      shipments: [],
    });
    expect(
      (await fetchAdminOrder(id, controller())).order.items[0].productId,
    ).toBeNull();
  });
  it.each([
    (value: AdminOrderDetail) => {
      value.order.id = otherId;
    },
    (value: AdminOrderDetail) => {
      value.payments[0].orderId = otherId;
    },
    (value: AdminOrderDetail) => {
      value.payments[0].shipmentId = shipmentId;
    },
    (value: AdminOrderDetail) => {
      value.payments[0].status = "UNKNOWN" as never;
    },
    (value: AdminOrderDetail) => {
      value.payments[0].amount = "-1.00";
    },
    (value: AdminOrderDetail) => {
      value.shipments[0].items[0].orderItemId = "different-order-item";
    },
    (value: AdminOrderDetail) => {
      value.shipments[0].items[0].quantity = 3;
    },
    (value: AdminOrderDetail) => {
      value.shipments[0].items = [];
    },
    (value: AdminOrderDetail) => {
      value.shipments[0].status = "PACKED" as never;
    },
    (value: AdminOrderDetail) => {
      value.shipments[0].shippingCost = "12.6";
    },
  ])("rejects foreign or inconsistent detail data", async (change) => {
    const value = detail();
    change(value);
    vi.mocked(authorized).mockResolvedValue(value);
    await expect(fetchAdminOrder(id, controller())).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
  it("rejects duplicate payment and shipment entries", async () => {
    const value = detail();
    value.payments.push(value.payments[0]);
    vi.mocked(authorized).mockResolvedValue(value);
    await expect(fetchAdminOrder(id, controller())).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
    value.payments.pop();
    value.shipments.push(value.shipments[0]);
    await expect(fetchAdminOrder(id, controller())).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
  it("rejects malformed UUIDs before HTTP", async () => {
    await expect(
      fetchAdminOrder("not-an-id", controller()),
    ).rejects.toMatchObject({ status: 400 });
    expect(authorized).not.toHaveBeenCalled();
  });
});

describe("Read deadlines and errors", () => {
  it("bounds unresolved responses even when the session helper ignores abort", async () => {
    vi.useFakeTimers();
    vi.mocked(authorized).mockImplementation(() => new Promise(() => {}));
    const abort = controller();
    const result = fetchAdminOrder(id, abort);
    const rejected = expect(result).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(15000);
    await rejected;
    expect(abort.signal.aborted).toBe(true);
    expect(authorized).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not send a previously aborted request", async () => {
    const abort = controller();
    abort.abort();
    await expect(fetchAdminOrders({}, 1, abort)).rejects.toMatchObject({
      code: "ABORTED",
    });
    expect(authorized).not.toHaveBeenCalled();
  });
  it("aborts a pending request and removes its listener/timer", async () => {
    vi.useFakeTimers();
    const abort = controller();
    const remove = vi.spyOn(abort.signal, "removeEventListener");
    vi.mocked(authorized).mockImplementation(() => new Promise(() => {}));
    const result = fetchAdminOrders({}, 1, abort);
    const rejected = expect(result).rejects.toMatchObject({ code: "ABORTED" });
    abort.abort();
    await rejected;
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([400, 401, 403, 404, 429, 503])(
    "preserves safe HTTP status %s without a server error message",
    async (status) => {
      vi.mocked(authorized).mockRejectedValue(
        Object.assign(new Error("SECRET_DATABASE_CONNECTION"), {
          status,
          providerResponse: "SECRET",
        }),
      );
      const error = await fetchAdminOrder(id, controller()).catch(
        (caught) => caught,
      );
      expect(error.status).toBe(status);
      expect(JSON.stringify(error)).not.toContain("SECRET");
      expect(error.message).not.toContain("SECRET");
      expect(adminOrderError(error)).not.toContain("SECRET");
      expect(authorized).toHaveBeenCalledTimes(1);
    },
  );
  it("sanitizes unexpected network errors and fixed UI messages", async () => {
    vi.mocked(authorized).mockRejectedValue(new Error("SECRET_API_URL"));
    const error = await fetchAdminOrder(id, controller()).catch(
      (caught) => caught,
    );
    expect(error.message).not.toContain("SECRET");
    expect(adminOrderError(error)).toContain("Tente novamente");
    expect(adminOrderError({ code: "INVALID_RESPONSE" })).toContain("conferir");
    expect(adminOrderError({ status: 504 })).toContain("demorou");
  });
});

describe("Sales money precision", () => {
  it.each([
    ["0.00", "R$\u00a00,00"],
    ["0.01", "R$\u00a00,01"],
    ["1234.56", "R$\u00a01.234,56"],
    ["9007199254740993.01", "R$\u00a09.007.199.254.740.993,01"],
    [
      "1000000000000000000000000000000000000.99",
      "R$\u00a01.000.000.000.000.000.000.000.000.000.000.000.000,99",
    ],
  ])("formats %s without rounding cents", (value, expected) =>
    expect(salesMoney(value)).toBe(expected),
  );
  it.each(["-1.00", "1", "1.1", "01.00", "1e3", "NaN", "a".repeat(65)])(
    "has a safe fallback for invalid money %s",
    (value) => expect(salesMoney(value)).toBe("Valor indisponível"),
  );
});
