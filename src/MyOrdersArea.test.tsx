// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MyOrders } from "./MyOrdersArea";
import type { Order, PixResult } from "./purchase";
import { authorized } from "./session";

vi.mock("./session", () => ({ authorized: vi.fn() }));
const time = "2026-10-26T12:00:00.000Z";
const expiry = "2099-10-26T12:30:00.000Z";
const clone = <T,>(value: T): T => structuredClone(value);
function order(index = 18, status: Order["status"] = "PENDING_PAYMENT"): Order {
  return {
    id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    orderNumber: index,
    status,
    subtotal: "10.00",
    shippingAmount: "0.00",
    discountAmount: "0.00",
    total: "10.00",
    createdAt: time,
    updatedAt: time,
    paidAt: status === "PAID" ? time : null,
    expiresAt: expiry,
    cancelledAt: status === "CANCELLED" ? time : null,
    items: [
      {
        id: `item-${index}`,
        productId: `product-${index}`,
        cardName: "Pikachu de teste",
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
  };
}
const first = order();
function payment(
  status: PixResult["payment"]["status"],
  method: PixResult["payment"]["method"] = "PIX",
): PixResult["payment"] {
  return {
    id: "20000000-0000-4000-8000-000000000001",
    orderId: first.id,
    shipmentId: null,
    provider: "provider:test",
    method,
    status,
    amount: "10.00",
    installments: 1,
    createdAt: time,
    updatedAt: time,
    paidAt: status === "PAID" ? time : null,
    failedAt: status === "FAILED" ? time : null,
    expiresAt: "2000-01-01T00:00:00.000Z",
  };
}
const error = (status: number) =>
  Object.assign(new Error("SECRET_INTERNAL_DO_NOT_RENDER"), { status });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let rows: Order[];
let history: PixResult["payment"][];
let historyError: unknown;
let detailError: unknown;
let cancelError: unknown;
let listError: unknown;
let failedPage: number;
let cancelReply: (() => Promise<unknown>) | undefined;
async function server(path: string, request: RequestInit = {}) {
  if (path.startsWith("/orders?")) {
    const page = Number(
      new URL(path, "http://preview.local").searchParams.get("page"),
    );
    if (listError && page === failedPage) throw listError;
    return clone({
      items: rows.slice((page - 1) * 20, page * 20),
      page,
      pageSize: 20,
      total: rows.length,
    });
  }
  if (request.method === "POST") {
    if (cancelReply) return cancelReply();
    if (cancelError) throw cancelError;
    const id = path.replace("/orders/", "").replace("/cancel", "");
    const original = rows.find((row) => row.id === id);
    if (!original) throw error(404);
    const cancelled = {
      ...original,
      status: "CANCELLED" as const,
      cancelledAt: time,
    };
    rows = rows.map((row) => (row.id === id ? cancelled : row));
    return clone(cancelled);
  }
  if (path.endsWith("/payments")) {
    if (historyError) throw historyError;
    return clone(history);
  }
  if (detailError) throw detailError;
  const found = rows.find((row) => path === `/orders/${row.id}`);
  if (!found) throw error(404);
  return clone(found);
}
const writes = () =>
  vi
    .mocked(authorized)
    .mock.calls.filter(([, request]) => request?.method === "POST");
const trueSession = () => true;
function view(isCurrentSession = trueSession) {
  const props = {
    onOpen: vi.fn(),
    onBusyChange: vi.fn(),
    onChanged: vi.fn(),
    isCurrentSession,
  };
  return { ...render(<MyOrders {...props} />), props };
}
async function loaded() {
  await screen.findByText("Pedido #18");
}
async function review() {
  fireEvent.click(
    screen.getByRole("button", {
      name: "Verificar cancelamento do pedido #18",
    }),
  );
  await screen.findByRole("heading", { name: "Cancelamento do pedido #18" });
  await waitFor(() =>
    expect(screen.queryByText("Conferindo pedido e pagamentos…")).toBeNull(),
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  rows = [clone(first)];
  history = [];
  historyError = undefined;
  detailError = undefined;
  cancelError = undefined;
  listError = undefined;
  cancelReply = undefined;
  failedPage = 1;
  vi.mocked(authorized).mockImplementation(server);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("MyOrders cancellation", () => {
  it("lists only the customer's orders and opens an existing order without cancelling", async () => {
    const { props } = view();
    await loaded();
    expect(authorized).toHaveBeenCalledTimes(1);
    expect(authorized).toHaveBeenCalledWith(
      "/orders?page=1&pageSize=20",
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        cache: "no-store",
      }),
    );
    fireEvent.click(screen.getByText("Pedido #18"));
    expect(props.onOpen).toHaveBeenCalledWith(first);
    expect(writes()).toHaveLength(0);
  });
  it("offers verification only for pending orders", async () => {
    rows.push(order(19, "PAID"), order(20, "CANCELLED"));
    view();
    await loaded();
    expect(
      screen.getAllByRole("button", { name: /Verificar cancelamento/ }),
    ).toHaveLength(1);
  });
  it("requires fresh order and history reads and explicit confirmation", async () => {
    view();
    await loaded();
    await review();
    expect(authorized).toHaveBeenCalledWith(
      `/orders/${first.id}`,
      expect.objectContaining({ method: "GET" }),
    );
    expect(authorized).toHaveBeenCalledWith(
      `/orders/${first.id}/payments`,
      expect.objectContaining({ method: "GET" }),
    );
    expect(writes()).toHaveLength(0);
    expect(screen.getByText("1× Pikachu de teste")).toBeTruthy();
    expect(screen.getByText(/reserva das cartas será liberada/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Confirmar cancelamento" }),
    ).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("heading", { name: "Cancelamento do pedido #18" }),
      ),
    );
  });
  it("cancels only after confirmation and updates the canonical status without restoring the cart", async () => {
    const { props } = view();
    await loaded();
    await review();
    fireEvent.click(
      screen.getByRole("button", { name: "Confirmar cancelamento" }),
    );
    await screen.findByText(
      "Pedido #18 cancelado. A reserva das cartas foi liberada.",
    );
    expect(writes()).toEqual([
      [
        `/orders/${first.id}/cancel`,
        expect.objectContaining({ method: "POST", cache: "no-store" }),
      ],
    ]);
    expect(writes()[0][1]?.body).toBeUndefined();
    expect(writes()[0][1]?.headers).toBeUndefined();
    expect(props.onChanged).toHaveBeenCalledTimes(1);
    expect(props.onBusyChange.mock.calls).toEqual([[true], [false]]);
    expect(
      screen.queryByRole("button", { name: "Confirmar cancelamento" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Voltar aos pedidos" }));
    expect(screen.getByText("Cancelado")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /Verificar cancelamento/ }),
    ).toBeNull();
    expect(
      vi
        .mocked(authorized)
        .mock.calls.some(([path]) => path.startsWith("/cart")),
    ).toBe(false);
  });
  it("leaves the review without sending a mutation", async () => {
    view();
    await loaded();
    await review();
    fireEvent.click(screen.getByRole("button", { name: "Voltar aos pedidos" }));
    expect(screen.getByText("Pedido #18")).toBeTruthy();
    expect(writes()).toHaveLength(0);
  });
  it.each(["PENDING", "PAID", "REFUNDED"] as const)(
    "blocks %s payment even for another method and an old displayed expiry",
    async (status) => {
      history = [payment(status, "BOLETO")];
      view();
      await loaded();
      await review();
      expect(
        screen.queryByRole("button", { name: "Confirmar cancelamento" }),
      ).toBeNull();
      expect(
        screen.getByText(
          /pagamento em processamento, confirmado ou reembolsado/,
        ),
      ).toBeTruthy();
      expect(writes()).toHaveLength(0);
    },
  );
  it.each(["FAILED", "EXPIRED", "CANCELLED"] as const)(
    "allows review with only %s payment history",
    async (status) => {
      history = [payment(status)];
      view();
      await loaded();
      await review();
      expect(
        screen.getByRole("button", { name: "Confirmar cancelamento" }),
      ).toBeTruthy();
      expect(writes()).toHaveLength(0);
    },
  );
  it("refreshes stale pending state before offering cancellation", async () => {
    view();
    await loaded();
    rows[0] = order(18, "PAID");
    await review();
    expect(
      screen.queryByRole("button", { name: "Confirmar cancelamento" }),
    ).toBeNull();
    expect(screen.getByText(/mudou de situação/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Voltar aos pedidos" }));
    expect(screen.getByText("Pagamento confirmado")).toBeTruthy();
    expect(writes()).toHaveLength(0);
  });
  it("recognizes an already cancelled order without another POST or notification", async () => {
    const { props } = view();
    await loaded();
    rows[0] = order(18, "CANCELLED");
    await review();
    expect(screen.getByText("Este pedido já está cancelado.")).toBeTruthy();
    expect(writes()).toHaveLength(0);
    expect(props.onChanged).not.toHaveBeenCalled();
  });
  it("does not treat a failed payment-history read as an empty history", async () => {
    historyError = error(503);
    view();
    await loaded();
    await review();
    expect(
      screen.queryByRole("button", { name: "Confirmar cancelamento" }),
    ).toBeNull();
    expect(screen.getByRole("alert").textContent).not.toContain(
      "SECRET_INTERNAL",
    );
    historyError = undefined;
    fireEvent.click(
      screen.getByRole("button", { name: "Atualizar situação do pedido" }),
    );
    await screen.findByRole("button", { name: "Confirmar cancelamento" });
    expect(writes()).toHaveLength(0);
  });
  it("requires a new GET after conflict and never repeats the POST automatically", async () => {
    cancelError = error(409);
    view();
    await loaded();
    await review();
    fireEvent.click(
      screen.getByRole("button", { name: "Confirmar cancelamento" }),
    );
    await screen.findByRole("button", { name: "Atualizar situação do pedido" });
    expect(
      screen.queryByRole("button", { name: "Confirmar cancelamento" }),
    ).toBeNull();
    expect(writes()).toHaveLength(1);
    rows[0] = order(18, "PAID");
    fireEvent.click(
      screen.getByRole("button", { name: "Atualizar situação do pedido" }),
    );
    await screen.findByText(/mudou de situação/);
    expect(writes()).toHaveLength(1);
  });
  it("recovers a lost cancellation result by GET and notifies the catalog once", async () => {
    cancelReply = async () => {
      rows[0] = order(18, "CANCELLED");
      throw new Error("SECRET_PROVIDER_KEY");
    };
    const { props } = view();
    await loaded();
    await review();
    fireEvent.click(
      screen.getByRole("button", { name: "Confirmar cancelamento" }),
    );
    await screen.findByRole("button", { name: "Atualizar situação do pedido" });
    expect(props.onChanged).not.toHaveBeenCalled();
    expect(writes()).toHaveLength(1);
    expect(screen.getByRole("alert").textContent).not.toContain(
      "SECRET_PROVIDER_KEY",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Atualizar situação do pedido" }),
    );
    await screen.findByText(
      "Pedido #18 cancelado. A reserva das cartas foi liberada.",
    );
    expect(props.onChanged).toHaveBeenCalledTimes(1);
    expect(writes()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Voltar aos pedidos" }));
    fireEvent.click(screen.getByRole("button", { name: "Atualizar pedidos" }));
    await loaded();
    expect(props.onChanged).toHaveBeenCalledTimes(1);
  });
  it("requires both a new inspection and another explicit confirmation for an unconfirmed pending order", async () => {
    cancelError = error(503);
    view();
    await loaded();
    await review();
    fireEvent.click(
      screen.getByRole("button", { name: "Confirmar cancelamento" }),
    );
    await screen.findByRole("button", { name: "Atualizar situação do pedido" });
    cancelError = undefined;
    fireEvent.click(
      screen.getByRole("button", { name: "Atualizar situação do pedido" }),
    );
    await screen.findByRole("button", { name: "Confirmar cancelamento" });
    expect(writes()).toHaveLength(1);
    fireEvent.click(
      screen.getByRole("button", { name: "Confirmar cancelamento" }),
    );
    await screen.findByText(
      "Pedido #18 cancelado. A reserva das cartas foi liberada.",
    );
    expect(writes()).toHaveLength(2);
  });
  it("treats a non-cancelled POST response as unconfirmed", async () => {
    cancelReply = async () => clone(first);
    const { props } = view();
    await loaded();
    await review();
    fireEvent.click(
      screen.getByRole("button", { name: "Confirmar cancelamento" }),
    );
    await screen.findByRole("button", { name: "Atualizar situação do pedido" });
    expect(props.onChanged).not.toHaveBeenCalled();
    expect(screen.queryByText(/reserva das cartas foi liberada/)).toBeNull();
  });
  it("blocks duplicate confirmation and navigation during the write", async () => {
    const pending = deferred<Order>();
    cancelReply = () => pending.promise;
    const { props } = view();
    await loaded();
    await review();
    const confirm = screen.getByRole("button", {
      name: "Confirmar cancelamento",
    });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(writes()).toHaveLength(1);
    expect(
      (
        screen.getByRole("button", {
          name: "Voltar aos pedidos",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(props.onBusyChange.mock.calls).toEqual([[true]]);
    await act(async () => pending.resolve(order(18, "CANCELLED")));
    await screen.findByText(/reserva das cartas foi liberada/);
    expect(props.onBusyChange.mock.calls).toEqual([[true], [false]]);
  });
  it("aborts a pending cancellation on unmount and releases its parent lock exactly once", async () => {
    const pending = deferred<Order>();
    cancelReply = () => pending.promise;
    const { props, unmount } = view();
    await loaded();
    await review();
    fireEvent.click(
      screen.getByRole("button", { name: "Confirmar cancelamento" }),
    );
    const signal = writes()[0][1]?.signal;
    unmount();
    expect(signal?.aborted).toBe(true);
    expect(props.onBusyChange.mock.calls).toEqual([[true], [false]]);
    await act(async () => pending.resolve(order(18, "CANCELLED")));
    expect(props.onChanged).not.toHaveBeenCalled();
    expect(props.onBusyChange.mock.calls).toEqual([[true], [false]]);
  });
  it("discards a cancellation result when the session changes", async () => {
    let current = true;
    const pending = deferred<Order>();
    cancelReply = () => pending.promise;
    const { props, rerender, unmount } = view(() => current);
    await loaded();
    await review();
    fireEvent.click(
      screen.getByRole("button", { name: "Confirmar cancelamento" }),
    );
    current = false;
    rerender(<MyOrders {...props} />);
    await act(async () => pending.resolve(order(18, "CANCELLED")));
    expect(props.onChanged).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Lista de pedidos")).toBeNull();
    expect(props.onBusyChange.mock.calls).toEqual([[true]]);
    unmount();
    expect(props.onBusyChange.mock.calls).toEqual([[true], [false]]);
  });
  it("discards obsolete inspection results after returning to the list", async () => {
    const pending = deferred<Order>();
    vi.mocked(authorized).mockImplementation(async (path, request) =>
      path === `/orders/${first.id}` ? pending.promise : server(path, request),
    );
    view();
    await loaded();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Verificar cancelamento do pedido #18",
      }),
    );
    await screen.findByRole("heading", { name: "Cancelamento do pedido #18" });
    fireEvent.click(screen.getByRole("button", { name: "Voltar aos pedidos" }));
    await act(async () => pending.resolve(order(18, "PAID")));
    expect(screen.getByText("Pedido #18")).toBeTruthy();
    expect(screen.queryByLabelText("Revisão do cancelamento")).toBeNull();
    expect(writes()).toHaveLength(0);
  });
  it("retains earlier pages after a load-more failure and retries only that page", async () => {
    rows = Array.from({ length: 21 }, (_, index) => order(index + 18));
    failedPage = 2;
    listError = error(503);
    const { container } = view();
    await loaded();
    fireEvent.click(
      screen.getByRole("button", { name: "Carregar mais pedidos" }),
    );
    await screen.findByRole("alert");
    expect(container.querySelectorAll(".order-row")).toHaveLength(20);
    listError = undefined;
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    await screen.findByText("Pedido #38");
    expect(container.querySelectorAll(".order-row")).toHaveLength(21);
    expect(
      screen.queryByRole("button", { name: "Carregar mais pedidos" }),
    ).toBeNull();
    expect(
      vi
        .mocked(authorized)
        .mock.calls.filter(([path]) => path === "/orders?page=2&pageSize=20"),
    ).toHaveLength(2);
  });
  it("deduplicates overlapping pages while applying the newer canonical status", async () => {
    rows = Array.from({ length: 21 }, (_, index) => order(index + 18));
    vi.mocked(authorized).mockImplementation(async (path, request) =>
      path === "/orders?page=2&pageSize=20"
        ? { items: [order(18, "PAID")], page: 2, pageSize: 20, total: 21 }
        : server(path, request),
    );
    const { container } = view();
    await loaded();
    fireEvent.click(
      screen.getByRole("button", { name: "Carregar mais pedidos" }),
    );
    await screen.findByText("Pagamento confirmado");
    expect(container.querySelectorAll(".order-row")).toHaveLength(20);
  });
  it("clears protected results after an authorization failure", async () => {
    detailError = error(401);
    view();
    await loaded();
    await review();
    expect(screen.getByRole("alert").textContent).toContain("Entre novamente");
    expect(screen.queryByText("Pedido #18")).toBeNull();
    expect(writes()).toHaveLength(0);
  });
  it("shows a meaningful empty history", async () => {
    rows = [];
    view();
    await screen.findByText("Você ainda não tem pedidos.");
    expect(writes()).toHaveLength(0);
  });
});
