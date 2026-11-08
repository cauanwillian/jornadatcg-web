// @vitest-environment jsdom
import { useEffect, useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountActions, ShopProvider } from "./Shop";
import * as session from "./session";
import type { User } from "./session";
import type { Order } from "./purchase";

interface OrdersPanelProps {
  isCurrentSession: () => boolean;
  onBusyChange: (busy: boolean) => void;
  onOpen: (order: Order) => void;
  onChanged: () => void;
}
const panels = vi.hoisted(() => ({
  sequence: 0,
  mounted: [] as Array<{ instance: number; props: OrdersPanelProps }>,
  removed: [] as number[],
}));
vi.mock("./session", () => ({
  subscribe: vi.fn(),
  refresh: vi.fn(),
  authorized: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
}));
vi.mock("./MyOrdersArea", () => ({
  MyOrders: (props: OrdersPanelProps) => {
    const [snapshot] = useState(() => ({ instance: ++panels.sequence, props }));
    const [draft, setDraft] = useState("");
    useEffect(() => {
      panels.mounted.push(snapshot);
      return () => {
        panels.removed.push(snapshot.instance);
      };
    }, [snapshot]);
    return (
      <section aria-label="Pedidos simulados">
        <p>Instância de pedidos {snapshot.instance}</p>
        <label>
          Rascunho de cancelamento
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        <button onClick={() => props.onBusyChange(true)}>
          Iniciar cancelamento
        </button>
        <button onClick={() => props.onBusyChange(false)}>
          Concluir cancelamento
        </button>
        <button onClick={() => props.onOpen(order)}>Abrir pagamento</button>
        <button onClick={props.onChanged}>Notificar cancelamento</button>
      </section>
    );
  },
}));
vi.mock("./Checkout", () => ({
  Checkout: ({ initialOrder }: { initialOrder?: Order }) => (
    <section aria-label="Pedido aberto">
      <p>Pedido selecionado: {initialOrder?.id}</p>
    </section>
  ),
}));
const customer: User = {
  id: "orders-customer",
  name: "Cliente teste",
  email: "customer@example.com",
  role: "CUSTOMER",
};
const second: User = {
  ...customer,
  id: "orders-second",
  name: "Outra pessoa",
  email: "second@example.com",
};
const order: Order = {
  id: "11111111-1111-4111-8111-111111111111",
  orderNumber: 18,
  status: "PENDING_PAYMENT",
  subtotal: "10.00",
  total: "10.00",
  shippingAmount: "0.00",
  discountAmount: "0.00",
  createdAt: "2026-10-26T12:00:00.000Z",
  updatedAt: "2026-10-26T12:00:00.000Z",
  paidAt: null,
  expiresAt: "2099-10-26T12:15:00.000Z",
  cancelledAt: null,
  items: [],
};
let notify: (user: User | null) => void;
let restored: User | null;
beforeEach(() => {
  vi.resetAllMocks();
  panels.sequence = 0;
  panels.mounted = [];
  panels.removed = [];
  restored = customer;
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
    if (!restored) throw new Error("Sessão ausente.");
    notify(restored);
    return { user: restored, accessToken: "test", expiresIn: 900 };
  });
  vi.mocked(session.authorized).mockResolvedValue({
    items: [],
    summary: { totalQuantity: 0, subtotal: "0.00" },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function mount() {
  render(
    <ShopProvider>
      <AccountActions />
    </ShopProvider>,
  );
}
async function openOrders() {
  mount();
  await screen.findByRole("button", { name: "Cliente" });
  fireEvent.click(screen.getByRole("button", { name: "Cliente" }));
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Meus pedidos",
    }),
  );
}
function closeButton() {
  return screen.getByRole<HTMLButtonElement>("button", { name: "Fechar" });
}
function begin() {
  fireEvent.click(screen.getByRole("button", { name: "Iniciar cancelamento" }));
}
function finish() {
  fireEvent.click(
    screen.getByRole("button", { name: "Concluir cancelamento" }),
  );
}
function openPayment() {
  fireEvent.click(screen.getByRole("button", { name: "Abrir pagamento" }));
}
function clearDraft() {
  expect(
    (screen.getByLabelText("Rascunho de cancelamento") as HTMLInputElement)
      .value,
  ).toBe("");
}

describe("My orders account access", () => {
  it("requires sign-in and does not expose another person's orders to visitors", () => {
    restored = null;
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(
      screen.getByRole("dialog", { name: "Entre na sua jornada" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Meus pedidos" })).toBeNull();
    expect(screen.queryByLabelText("Pedidos simulados")).toBeNull();
    expect(session.authorized).not.toHaveBeenCalled();
  });
  it.each(["CUSTOMER", "ADMIN"])(
    "opens owned orders for a %s account without making writes",
    async (role) => {
      restored = { ...customer, role };
      await openOrders();
      expect(screen.getByRole("dialog", { name: "Meus pedidos" })).toBeTruthy();
      expect(screen.getByLabelText("Pedidos simulados")).toBeTruthy();
      expect(panels.mounted[0].props.isCurrentSession()).toBe(true);
      expect(
        vi
          .mocked(session.authorized)
          .mock.calls.every(([path]) => path === "/cart"),
      ).toBe(true);
      expect(screen.queryByLabelText("Pedido aberto")).toBeNull();
    },
  );
  it("locks close, Escape and other navigation during cancellation", async () => {
    await openOrders();
    begin();
    expect(closeButton().disabled).toBe(true);
    fireEvent.click(closeButton());
    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { bubbles: true, cancelable: true }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Carrinho/ }));
    fireEvent.click(screen.getByRole("button", { name: "Notificações" }));
    fireEvent.click(screen.getByRole("button", { name: "Cliente" }));
    expect(screen.getByRole("dialog", { name: "Meus pedidos" })).toBeTruthy();
    finish();
    expect(closeButton().disabled).toBe(false);
    fireEvent.click(closeButton());
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("opens checkout only after the current panel explicitly chooses an order", async () => {
    await openOrders();
    expect(screen.queryByLabelText("Pedido aberto")).toBeNull();
    openPayment();
    expect(screen.getByRole("dialog", { name: "Pedido #18" })).toBeTruthy();
    expect(screen.getByText(`Pedido selecionado: ${order.id}`)).toBeTruthy();
    expect(screen.queryByLabelText("Pedidos simulados")).toBeNull();
    expect(
      vi
        .mocked(session.authorized)
        .mock.calls.every(([path]) => path === "/cart"),
    ).toBe(true);
  });
  it("does not navigate to payment while a cancellation owns the busy lock", async () => {
    await openOrders();
    begin();
    openPayment();
    expect(screen.getByRole("dialog", { name: "Meus pedidos" })).toBeTruthy();
    expect(screen.queryByLabelText("Pedido aberto")).toBeNull();
    finish();
    openPayment();
    expect(screen.getByRole("dialog", { name: "Pedido #18" })).toBeTruthy();
  });
  it("clears the panel and ignores its callbacks after logout", async () => {
    const changed = vi.fn();
    window.addEventListener("jornada-catalog-changed", changed);
    try {
      await openOrders();
      const old = panels.mounted[0];
      begin();
      act(() => notify(null));
      expect(
        screen.getByRole("dialog", { name: "Entre na sua jornada" }),
      ).toBeTruthy();
      expect(old.props.isCurrentSession()).toBe(false);
      expect(panels.removed).toContain(old.instance);
      expect(screen.queryByLabelText("Pedidos simulados")).toBeNull();
      act(() => {
        old.props.onBusyChange(true);
        old.props.onOpen(order);
        old.props.onChanged();
      });
      expect(closeButton().disabled).toBe(false);
      expect(screen.queryByLabelText("Pedido aberto")).toBeNull();
      expect(changed).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("jornada-catalog-changed", changed);
    }
  });
  it("replaces account drafts and prevents old callbacks from unlocking or opening another person's panel", async () => {
    const changed = vi.fn();
    window.addEventListener("jornada-catalog-changed", changed);
    try {
      await openOrders();
      const old = panels.mounted[0];
      fireEvent.change(screen.getByLabelText("Rascunho de cancelamento"), {
        target: { value: "Pedido anterior" },
      });
      begin();
      act(() => notify(second));
      expect(panels.mounted.at(-1)!.instance).not.toBe(old.instance);
      expect(old.props.isCurrentSession()).toBe(false);
      clearDraft();
      begin();
      act(() => {
        old.props.onBusyChange(false);
        old.props.onOpen(order);
        old.props.onChanged();
      });
      expect(closeButton().disabled).toBe(true);
      expect(screen.getByRole("dialog", { name: "Meus pedidos" })).toBeTruthy();
      expect(changed).not.toHaveBeenCalled();
      finish();
      act(() => old.props.onBusyChange(true));
      expect(closeButton().disabled).toBe(false);
    } finally {
      window.removeEventListener("jornada-catalog-changed", changed);
    }
  });
  it("invalidates the old panel after A switches to B and back to A in one batch", async () => {
    await openOrders();
    const old = panels.mounted[0];
    fireEvent.change(screen.getByLabelText("Rascunho de cancelamento"), {
      target: { value: "Rascunho antigo" },
    });
    act(() => {
      notify(second);
      notify(customer);
    });
    expect(panels.mounted.at(-1)!.instance).not.toBe(old.instance);
    expect(old.props.isCurrentSession()).toBe(false);
    clearDraft();
    begin();
    act(() => {
      old.props.onBusyChange(false);
      old.props.onOpen(order);
    });
    expect(closeButton().disabled).toBe(true);
    expect(screen.queryByLabelText("Pedido aberto")).toBeNull();
  });
  it("creates a new generation after the same customer logs out and logs in again", async () => {
    await openOrders();
    const old = panels.mounted[0];
    act(() => {
      notify(null);
      notify(customer);
    });
    expect(old.props.isCurrentSession()).toBe(false);
    expect(panels.removed).toContain(old.instance);
    fireEvent.click(closeButton());
    fireEvent.click(screen.getByRole("button", { name: "Cliente" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Meus pedidos",
      }),
    );
    expect(panels.mounted.at(-1)!.instance).not.toBe(old.instance);
    begin();
    act(() => {
      old.props.onBusyChange(false);
      old.props.onOpen(order);
    });
    expect(closeButton().disabled).toBe(true);
    expect(screen.getByRole("dialog", { name: "Meus pedidos" })).toBeTruthy();
  });
  it("refreshes the catalog only for the current cancellation callback", async () => {
    const changed = vi.fn();
    window.addEventListener("jornada-catalog-changed", changed);
    try {
      await openOrders();
      const old = panels.mounted[0];
      fireEvent.click(
        screen.getByRole("button", { name: "Notificar cancelamento" }),
      );
      expect(changed).toHaveBeenCalledTimes(1);
      act(() => {
        notify(second);
        notify(customer);
      });
      act(() => old.props.onChanged());
      expect(changed).toHaveBeenCalledTimes(1);
      fireEvent.click(
        screen.getByRole("button", { name: "Notificar cancelamento" }),
      );
      expect(changed).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener("jornada-catalog-changed", changed);
    }
  });
});
