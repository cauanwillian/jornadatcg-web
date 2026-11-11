// @vitest-environment jsdom
import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShopProvider, AccountActions } from "./Shop";
import * as session from "./session";
import type { User } from "./session";
import type { Order } from "./purchase";

vi.mock("./session", () => ({
  subscribe: vi.fn(),
  refresh: vi.fn(),
  authorized: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
}));
vi.mock("./NotificationsArea", () => ({
  NotificationsArea: (props: {
    onOpenTarget: (target: {
      type: "order" | "shipment";
      id: string;
    }) => Promise<void>;
  }) => {
    const [error, setError] = useState("");
    const open = (type: "order" | "shipment") =>
      void props
        .onOpenTarget({ type, id: targetId })
        .catch(() => setError("Detalhe indisponível."));
    return (
      <section aria-label="Central simulada">
        <button onClick={() => open("order")}>Abrir pedido de teste</button>
        <button onClick={() => open("shipment")}>Abrir envio de teste</button>
        {error && <p role="alert">{error}</p>}
      </section>
    );
  },
}));
vi.mock("./Checkout", () => ({
  Checkout: (props: { initialOrder?: Order }) => (
    <p>Pedido aberto: {props.initialOrder?.orderNumber}</p>
  ),
  MyOrders: () => null,
}));
vi.mock("./ShippingArea", () => ({
  Shipping: (props: { initialShipmentId?: string }) => (
    <p>Envio aberto: {props.initialShipmentId ?? "lista"}</p>
  ),
}));
const targetId = "11111111-1111-4111-8111-111111111111";
const user: User = {
  id: "user-a",
  name: "Cliente",
  email: "example@example.com",
  role: "CUSTOMER",
};
const order: Order = {
  id: targetId,
  orderNumber: 42,
  status: "PAID",
  subtotal: "10.00",
  total: "10.00",
  shippingAmount: "0.00",
  discountAmount: "0.00",
  createdAt: "2026-10-01T12:00:00.000Z",
  updatedAt: "2026-10-02T12:00:00.000Z",
  paidAt: "2026-10-02T12:00:00.000Z",
  expiresAt: null,
  cancelledAt: null,
  items: [
    {
      id: targetId,
      productId: null,
      cardName: "Pikachu",
      cardNumber: "025",
      setName: "Teste",
      conditionName: "NM",
      languageName: "Português",
      categoryName: "Singles",
      quantity: 1,
      unitPrice: "10.00",
      totalPrice: "10.00",
    },
  ],
};
let notify: (user: User | null) => void;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  HTMLDialogElement.prototype.showModal = vi.fn(function (
    this: HTMLDialogElement,
  ) {
    this.open = true;
  });
  vi.mocked(session.subscribe).mockImplementation((listener) => {
    notify = listener;
    return () => {};
  });
  vi.mocked(session.refresh).mockImplementation(async () => {
    notify(user);
    return { user, accessToken: "test", expiresIn: 900 };
  });
  vi.mocked(session.authorized).mockImplementation(async (path) =>
    path.startsWith("/orders/")
      ? order
      : { items: [], summary: { totalQuantity: 0, subtotal: "0.00" } },
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
async function openCentral() {
  const view = render(
    <ShopProvider>
      <AccountActions />
    </ShopProvider>,
  );
  await screen.findByRole("button", { name: "Cliente" });
  fireEvent.click(screen.getByRole("button", { name: "Notificações" }));
  return view;
}
describe("Notifications navigation", () => {
  it("requires login for a signed-out visitor and does not fetch customer data", async () => {
    vi.mocked(session.refresh).mockRejectedValue(new Error());
    render(
      <ShopProvider>
        <AccountActions />
      </ShopProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Notificações" }));
    expect(
      screen.getByRole("dialog", { name: "Entre na sua conta" }),
    ).toBeTruthy();
    expect(
      screen.getByText("Entre para acompanhar seus pedidos e envios."),
    ).toBeTruthy();
    expect(session.authorized).not.toHaveBeenCalled();
  });
  it("opens the central from the header and the account", async () => {
    await openCentral();
    expect(screen.getByLabelText("Central simulada")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    fireEvent.click(screen.getByRole("button", { name: "Cliente" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Notificações",
      }),
    );
    expect(screen.getByRole("dialog", { name: "Notificações" })).toBeTruthy();
    expect(
      vi
        .mocked(session.authorized)
        .mock.calls.every(([path]) => path === "/cart"),
    ).toBe(true);
  });
  it("reads the selected existing order and opens checkout without a POST", async () => {
    await openCentral();
    fireEvent.click(
      screen.getByRole("button", { name: "Abrir pedido de teste" }),
    );
    await screen.findByText("Pedido aberto: 42");
    expect(screen.getByRole("dialog", { name: "Pedido #42" })).toBeTruthy();
    expect(session.authorized).toHaveBeenCalledWith(
      `/orders/${targetId}`,
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(
      vi
        .mocked(session.authorized)
        .mock.calls.some(([, options]) => options?.method === "POST"),
    ).toBe(false);
  });
  it("blocks duplicate opens, Escape, close and other navigation while reading the order", async () => {
    const pending = deferred<Order>();
    await openCentral();
    vi.mocked(session.authorized).mockReturnValue(pending.promise);
    fireEvent.click(
      screen.getByRole("button", { name: "Abrir pedido de teste" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Abrir pedido de teste" }),
    );
    expect(
      (screen.getByRole("button", { name: "Fechar" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { bubbles: true, cancelable: true }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Carrinho/ }));
    fireEvent.click(screen.getByRole("button", { name: "Notificações" }));
    expect(screen.getByRole("dialog", { name: "Notificações" })).toBeTruthy();
    expect(
      vi
        .mocked(session.authorized)
        .mock.calls.filter(([path]) => path.startsWith("/orders/")).length,
    ).toBe(1);
    await act(async () => pending.resolve(order));
    expect(
      (screen.getByRole("button", { name: "Fechar" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
  it("passes the shipment id to the existing shipping screen without creating anything", async () => {
    await openCentral();
    fireEvent.click(
      screen.getByRole("button", { name: "Abrir envio de teste" }),
    );
    await screen.findByText(`Envio aberto: ${targetId}`);
    expect(
      vi
        .mocked(session.authorized)
        .mock.calls.every(([path]) => path === "/cart"),
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    fireEvent.click(screen.getByRole("button", { name: "Cliente" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Compras acumuladas e envios" }),
    );
    expect(screen.getByText("Envio aberto: lista")).toBeTruthy();
  });
  it("does not open an order from a late response after account replacement", async () => {
    const pending = deferred<Order>();
    await openCentral();
    vi.mocked(session.authorized).mockImplementation(async (path) =>
      path.startsWith("/orders/")
        ? pending.promise
        : { items: [], summary: { totalQuantity: 0, subtotal: "0.00" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Abrir pedido de teste" }),
    );
    const signal = vi
      .mocked(session.authorized)
      .mock.calls.find(([path]) => path.startsWith("/orders/"))![1]!.signal!;
    act(() => notify({ ...user, id: "user-b", name: "Outra conta" }));
    expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve(order));
    expect(screen.queryByText("Pedido aberto: 42")).toBeNull();
    expect(screen.getByRole("dialog", { name: "Notificações" })).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Fechar" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
  it("discards a late response after logging out and back into the same account", async () => {
    const pending = deferred<Order>();
    await openCentral();
    vi.mocked(session.authorized).mockReturnValue(pending.promise);
    fireEvent.click(
      screen.getByRole("button", { name: "Abrir pedido de teste" }),
    );
    act(() => {
      notify(null);
      notify(user);
    });
    await act(async () => pending.resolve(order));
    expect(screen.queryByText("Pedido aberto: 42")).toBeNull();
  });
  it("rejects malformed or mismatched orders and lets the user retry", async () => {
    await openCentral();
    vi.mocked(session.authorized).mockResolvedValue({ ...order, id: "wrong" });
    fireEvent.click(
      screen.getByRole("button", { name: "Abrir pedido de teste" }),
    );
    await screen.findByRole("alert");
    expect(screen.getByRole("dialog", { name: "Notificações" })).toBeTruthy();
    vi.mocked(session.authorized).mockResolvedValue(order);
    fireEvent.click(
      screen.getByRole("button", { name: "Abrir pedido de teste" }),
    );
    await screen.findByText("Pedido aberto: 42");
  });
  it("releases the navigation lock when a read never settles", async () => {
    await openCentral();
    vi.useFakeTimers();
    vi.mocked(session.authorized).mockReturnValue(new Promise(() => {}));
    fireEvent.click(
      screen.getByRole("button", { name: "Abrir pedido de teste" }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15001);
    });
    expect(screen.getByRole("alert").textContent).toBe("Detalhe indisponível.");
    expect(
      (screen.getByRole("button", { name: "Fechar" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
  it("aborts the order read on unmount", async () => {
    const view = await openCentral();
    vi.mocked(session.authorized).mockReturnValue(new Promise(() => {}));
    fireEvent.click(
      screen.getByRole("button", { name: "Abrir pedido de teste" }),
    );
    const signal = vi
      .mocked(session.authorized)
      .mock.calls.find(([path]) => path.startsWith("/orders/"))![1]!.signal!;
    view.unmount();
    expect(signal.aborted).toBe(true);
  });
});
