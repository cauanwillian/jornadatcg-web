// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminOrdersArea } from "./AdminOrdersArea";
import { authorized } from "./session";
import type {
  AdminOrderDetail,
  AdminOrderRow,
  SalesSummary,
} from "./admin-orders";

vi.mock("./session", () => ({ authorized: vi.fn() }));
const id = (number: number) =>
  `${number.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`;
const date = "2026-11-04T12:00:00.000Z";
const customer = {
  id: id(100),
  name: "Cliente de demonstração",
  email: "cliente@example.com",
};
const makeRow = (number = 18): AdminOrderRow => ({
  id: id(number),
  orderNumber: number,
  status: "PAID",
  total: "20.00",
  createdAt: date,
  paidAt: date,
  cancelledAt: null,
  customer,
  quantity: 2,
});
const makeDetail = (): AdminOrderDetail => ({
  order: {
    id: id(18),
    orderNumber: 18,
    status: "PAID",
    subtotal: "20.00",
    shippingAmount: "0.00",
    discountAmount: "0.00",
    total: "20.00",
    createdAt: date,
    updatedAt: date,
    paidAt: date,
    expiresAt: null,
    cancelledAt: null,
    items: [
      {
        id: id(200),
        productId: id(201),
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
  customer,
  payments: [
    {
      id: id(300),
      orderId: id(18),
      shipmentId: null,
      provider: "asaas:sandbox",
      method: "PIX",
      status: "PAID",
      amount: "20.00",
      installments: 1,
      createdAt: date,
      updatedAt: date,
      paidAt: date,
      failedAt: null,
      expiresAt: null,
    },
  ],
  shipments: [
    {
      id: id(400),
      status: "READY_TO_SHIP",
      requestedAt: date,
      shippedAt: null,
      deliveredAt: null,
      trackingCode: null,
      shippingCost: "12.68",
      shippingPaidAt: date,
      items: [{ orderItemId: id(200), quantity: 1 }],
    },
  ],
});
const clone = <T,>(value: T): T => structuredClone(value);
const failure = (status: number) =>
  Object.assign(new Error("SECRET_INTERNAL_DO_NOT_RENDER"), { status });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let rows: AdminOrderRow[];
let detail: AdminOrderDetail;
let listError: unknown;
let detailError: unknown;
let reportSummary: SalesSummary | undefined;
async function server(path: string) {
  const url = new URL(path, "http://localhost");
  if (url.pathname === "/admin/orders") {
    if (listError) throw listError;
    const page = Number(url.searchParams.get("page"));
    const status = url.searchParams.get("status");
    const number = url.searchParams.get("orderNumber");
    const term = (url.searchParams.get("customer") ?? "").toLowerCase();
    const filtered = rows.filter(
      (row) =>
        (!status || row.status === status) &&
        (!number || String(row.orderNumber) === number) &&
        `${row.customer.name} ${row.customer.email}`
          .toLowerCase()
          .includes(term),
    );
    return {
      items: clone(filtered.slice((page - 1) * 20, page * 20)),
      page,
      pageSize: 20,
      total: filtered.length,
      summary: reportSummary ?? {
        orderCount: filtered.length,
        pendingCount: filtered.filter((row) => row.status === "PENDING_PAYMENT")
          .length,
        confirmedCount: filtered.filter((row) => row.status === "PAID").length,
        confirmedAmount: `${filtered.filter((row) => row.status === "PAID").length * 20}.00`,
      },
    };
  }
  if (
    url.pathname === `/admin/orders/${id(18)}` ||
    rows.some((row) => url.pathname === `/admin/orders/${row.id}`)
  ) {
    if (detailError) throw detailError;
    const wanted = url.pathname.split("/").at(-1)!;
    const row = rows.find((row) => row.id === wanted)!;
    return clone({
      ...detail,
      order: { ...detail.order, id: wanted, orderNumber: row.orderNumber },
      payments: detail.payments.map((payment) => ({
        ...payment,
        orderId: wanted,
      })),
    });
  }
  throw new Error(`Unexpected request ${path}`);
}
beforeEach(() => {
  rows = [makeRow()];
  detail = makeDetail();
  listError = undefined;
  detailError = undefined;
  reportSummary = undefined;
  vi.mocked(authorized).mockReset();
  vi.mocked(authorized).mockImplementation(server as typeof authorized);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function mount(props: Partial<Parameters<typeof AdminOrdersArea>[0]> = {}) {
  return render(<AdminOrdersArea isCurrentSession={() => true} {...props} />);
}
async function ready(number = 18) {
  await screen.findByRole("button", { name: `Ver pedido #${number}` });
}
async function open(number = 18) {
  await ready(number);
  fireEvent.click(
    screen.getByRole("button", { name: `Ver pedido #${number}` }),
  );
  await screen.findByRole("region", { name: "Detalhes do pedido" });
}
const calls = () => vi.mocked(authorized).mock.calls;
describe("Pedidos e vendas administrativos", () => {
  it("loads only the administrative report with GET and no-store", async () => {
    mount();
    await ready();
    expect(calls()).toHaveLength(1);
    expect(calls()[0]).toEqual([
      "/admin/orders?page=1&pageSize=20",
      expect.objectContaining({
        method: "GET",
        signal: expect.any(AbortSignal),
        cache: "no-store",
      }),
    ]);
    expect(screen.getByText("Valor das cartas vendidas")).toBeTruthy();
    expect(screen.getByText(/após descontos, sem frete/)).toBeTruthy();
    expect(screen.getByText(/não representa fluxo de caixa/)).toBeTruthy();
  });
  it("renders the complete filtered summary independently of visible page rows", async () => {
    rows = Array.from({ length: 21 }, (_, index) => makeRow(18 + index));
    reportSummary = {
      orderCount: 21,
      pendingCount: 3,
      confirmedCount: 17,
      confirmedAmount: "9007199254740993.01",
    };
    mount();
    await ready();
    const summary = screen.getByLabelText("Resumo dos pedidos filtrados");
    expect(within(summary).getByText("21")).toBeTruthy();
    expect(within(summary).getByText("17")).toBeTruthy();
    expect(
      within(summary).getByText("R$ 9.007.199.254.740.993,01", {
        exact: false,
      }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ver pedido #38" })).toBeNull();
  });
  it("does not fetch while editing filters and applies all filters explicitly", async () => {
    mount();
    await ready();
    fireEvent.change(screen.getByLabelText("Situação"), {
      target: { value: "PAID" },
    });
    fireEvent.change(screen.getByLabelText("Número do pedido"), {
      target: { value: "18" },
    });
    fireEvent.change(screen.getByLabelText("Nome ou e-mail do cliente"), {
      target: { value: " cliente@example.com " },
    });
    fireEvent.change(screen.getByLabelText("Criado a partir de"), {
      target: { value: "2026-11-01" },
    });
    fireEvent.change(screen.getByLabelText("Criado até"), {
      target: { value: "2026-11-04" },
    });
    expect(calls()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Aplicar filtros" }));
    await waitFor(() => expect(calls()).toHaveLength(2));
    const query = new URL(calls()[1][0], "http://localhost").searchParams;
    expect(Object.fromEntries(query)).toMatchObject({
      page: "1",
      pageSize: "20",
      status: "PAID",
      orderNumber: "18",
      customer: "cliente@example.com",
      from: new Date("2026-11-01T00:00:00").toISOString(),
      to: new Date("2026-11-05T00:00:00").toISOString(),
    });
    await ready();
  });
  it("rejects invalid filter values without requesting data and focuses the field", async () => {
    mount();
    await ready();
    fireEvent.change(screen.getByLabelText("Número do pedido"), {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar filtros" }));
    expect(calls()).toHaveLength(1);
    expect(document.activeElement).toBe(
      screen.getByLabelText("Número do pedido"),
    );
    expect(screen.getByText(/entre 1 e 2.147.483.647/)).toBeTruthy();
  });
  it("rejects a reversed date period without requesting data", async () => {
    mount();
    await ready();
    fireEvent.change(screen.getByLabelText("Criado a partir de"), {
      target: { value: "2026-11-05" },
    });
    fireEvent.change(screen.getByLabelText("Criado até"), {
      target: { value: "2026-11-04" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar filtros" }));
    expect(calls()).toHaveLength(1);
    expect(screen.getByText(/igual ou posterior/)).toBeTruthy();
  });
  it("clears draft and applied filters with a fresh first-page query", async () => {
    mount();
    await ready();
    fireEvent.change(screen.getByLabelText("Número do pedido"), {
      target: { value: "18" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar filtros" }));
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Limpar filtros" }));
    await waitFor(() => expect(calls()).toHaveLength(3));
    expect(calls()[2][0]).toBe("/admin/orders?page=1&pageSize=20");
    expect(
      (screen.getByLabelText("Número do pedido") as HTMLInputElement).value,
    ).toBe("");
  });
  it("paginates server results and restores the current page after viewing a detail", async () => {
    rows = Array.from({ length: 21 }, (_, index) => makeRow(18 + index));
    mount();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    await ready(38);
    expect(calls()[1][0]).toBe("/admin/orders?page=2&pageSize=20");
    expect(screen.getByText("Página 2 de 2")).toBeTruthy();
    await open(38);
    fireEvent.click(screen.getByRole("button", { name: "Voltar aos pedidos" }));
    await ready(38);
    expect(calls().at(-1)?.[0]).toBe("/admin/orders?page=2&pageSize=20");
  });
  it("uses the saved query for refresh rather than unsaved draft edits", async () => {
    mount();
    await ready();
    fireEvent.change(screen.getByLabelText("Número do pedido"), {
      target: { value: "99" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Atualizar pedidos" }));
    await waitFor(() => expect(calls()).toHaveLength(2));
    expect(calls()[1][0]).toBe("/admin/orders?page=1&pageSize=20");
  });
  it("queries fresh detail and shows snapshots, payment and partial shipment without inferring order status", async () => {
    mount();
    await open();
    expect(calls()[1][0]).toBe(`/admin/orders/${id(18)}`);
    const area = screen.getByRole("region", { name: "Detalhes do pedido" });
    expect(within(area).getByText("Cliente de demonstração")).toBeTruthy();
    expect(within(area).getByText(/2× Pikachu/)).toBeTruthy();
    expect(within(area).getByText("Pix · Pago")).toBeTruthy();
    expect(within(area).getByText("Pagamento confirmado")).toBeTruthy();
    expect(within(area).getByText("Pronto para envio")).toBeTruthy();
    expect(within(area).getByText("1× Pikachu")).toBeTruthy();
    expect(within(area).queryByText("null")).toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("heading", { name: "Pedido #18" }),
      ),
    );
  });
  it("opens shipment management only after explicit action", async () => {
    const onOpenShipment = vi.fn();
    mount({ onOpenShipment });
    await open();
    expect(onOpenShipment).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Ver envio" }));
    expect(onOpenShipment).toHaveBeenCalledWith(id(400));
    expect(calls()).toHaveLength(2);
  });
  it("blocks a displayed shipment action after losing session ownership", async () => {
    let current = true;
    const onOpenShipment = vi.fn();
    mount({ isCurrentSession: () => current, onOpenShipment });
    await open();
    const button = screen.getByRole("button", { name: "Ver envio" });
    current = false;
    fireEvent.click(button);
    expect(onOpenShipment).not.toHaveBeenCalled();
    expect(calls()).toHaveLength(2);
  });
  it("keeps freight zero awaiting payment as A calcular", async () => {
    detail.shipments[0].shippingCost = "0.00";
    detail.shipments[0].shippingPaidAt = null;
    mount();
    await open();
    expect(screen.getByText(/Frete: A calcular/)).toBeTruthy();
  });
  it("shows delivered tracking data without external navigation", async () => {
    detail.shipments[0] = {
      ...detail.shipments[0],
      status: "DELIVERED",
      shippedAt: date,
      deliveredAt: date,
      trackingCode: "TESTE123BR",
    };
    mount();
    await open();
    expect(screen.getByText("Entregue")).toBeTruthy();
    expect(screen.getByText("Rastreio: TESTE123BR")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });
  it("explains unrequested accumulated shipping and missing payments", async () => {
    detail.shipments = [];
    detail.payments = [];
    mount();
    await open();
    expect(
      screen.getByText("Nenhum pagamento registrado para este pedido."),
    ).toBeTruthy();
    expect(screen.getByText(/podem continuar acumuladas/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ver envio" })).toBeNull();
  });
  it("reloads authoritative detail explicitly", async () => {
    mount();
    await open();
    detail.order.status = "CANCELLED";
    detail.order.cancelledAt = date;
    fireEvent.click(screen.getByRole("button", { name: "Atualizar pedido" }));
    await screen.findByText("Cancelado");
    expect(calls().at(-1)?.[0]).toBe(`/admin/orders/${id(18)}`);
  });
  it("shows an empty report without a detail request", async () => {
    rows = [];
    mount();
    await screen.findByText(
      "Nenhum pedido encontrado para os filtros aplicados.",
    );
    expect(calls()).toHaveLength(1);
  });
  it.each([401, 403])(
    "clears report data and disables further access for status %i",
    async (status) => {
      mount();
      await ready();
      listError = failure(status);
      fireEvent.click(
        screen.getByRole("button", { name: "Atualizar pedidos" }),
      );
      await screen.findByText(
        "Acesso restrito a administradores. Entre novamente com uma conta autorizada.",
      );
      expect(screen.queryByText(customer.email)).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Atualizar pedidos" }),
      ).toBeNull();
    },
  );
  it("sanitizes list failures and retries the same applied query", async () => {
    listError = failure(503);
    mount();
    await screen.findByRole("alert");
    expect(document.body.textContent).not.toContain("SECRET");
    listError = undefined;
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    await ready();
    expect(calls()[1][0]).toBe(calls()[0][0]);
  });
  it("shows missing detail safely and permits returning to fresh list", async () => {
    detailError = failure(404);
    mount();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Ver pedido #18" }));
    await screen.findByText(
      "Pedido não encontrado. Atualize a lista de pedidos.",
    );
    expect(
      screen.queryByRole("region", { name: "Detalhes do pedido" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Voltar aos pedidos" }));
    await ready();
  });
  it("aborts a detail read when returning and discards its late response", async () => {
    const pending = deferred<AdminOrderDetail>();
    mount();
    await ready();
    vi.mocked(authorized).mockImplementationOnce(() => pending.promise);
    fireEvent.click(screen.getByRole("button", { name: "Ver pedido #18" }));
    const signal = calls()[1][1]?.signal;
    fireEvent.click(screen.getByRole("button", { name: "Voltar aos pedidos" }));
    await ready();
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      pending.resolve(clone(detail));
    });
    expect(
      screen.queryByRole("region", { name: "Detalhes do pedido" }),
    ).toBeNull();
  });
  it("discards responses and navigation callbacks after losing session ownership", async () => {
    let current = true;
    const onOpenShipment = vi.fn();
    const pending = deferred<AdminOrderDetail>();
    mount({ isCurrentSession: () => current, onOpenShipment });
    await ready();
    vi.mocked(authorized).mockImplementationOnce(() => pending.promise);
    fireEvent.click(screen.getByRole("button", { name: "Ver pedido #18" }));
    current = false;
    await act(async () => {
      pending.resolve(clone(detail));
    });
    expect(screen.queryByText("Pikachu")).toBeNull();
    expect(onOpenShipment).not.toHaveBeenCalled();
  });
  it("aborts its request when unmounted", async () => {
    const pending = deferred<unknown>();
    vi.mocked(authorized).mockImplementation(() => pending.promise);
    const view = mount();
    await waitFor(() => expect(calls()).toHaveLength(1));
    const signal = calls()[0][1]?.signal;
    view.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      pending.resolve({});
    });
  });
  it("never calls write or provider reconciliation endpoints", async () => {
    mount();
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Atualizar pedido" }));
    await screen.findByRole("region", { name: "Detalhes do pedido" });
    expect(
      calls().every(
        ([path, request]) =>
          path.startsWith("/admin/orders") && request?.method === "GET",
      ),
    ).toBe(true);
    expect(calls().some(([path]) => path.includes("payments/pix"))).toBe(false);
  });
});
