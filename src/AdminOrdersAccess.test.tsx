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

interface OrdersProps {
  isCurrentSession: () => boolean;
  onOpenShipment?: (id: string) => void;
}
interface ShipmentsProps {
  isCurrentSession: () => boolean;
  onBusyChange: (busy: boolean) => void;
  initialShipmentId?: string;
}
const captured = vi.hoisted(() => ({
  orders: [] as OrdersProps[],
  shipments: [] as ShipmentsProps[],
}));
const firstShipment = "68a7b7af-18a9-46ab-b44d-a7438cbb5c02";
const secondShipment = "18a7b7af-18a9-46ab-b44d-a7438cbb5c02";
vi.mock("./session", () => ({
  subscribe: vi.fn(),
  refresh: vi.fn(),
  authorized: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  invalidateSession: vi.fn(),
}));
vi.mock("./AdminOrdersArea", () => ({
  AdminOrdersArea: (props: OrdersProps) => {
    const [snapshot] = useState(() => props);
    const [draft, setDraft] = useState("");
    useEffect(() => {
      captured.orders.push(snapshot);
    }, [snapshot]);
    return (
      <section aria-label="Vendas simuladas">
        <label>
          Busca particular
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        <button onClick={() => props.onOpenShipment?.(firstShipment)}>
          Envio do pedido
        </button>
      </section>
    );
  },
}));
vi.mock("./AdminShipmentsArea", () => ({
  ShipmentManagement: (props: ShipmentsProps) => {
    const [snapshot] = useState(() => props);
    useEffect(() => {
      captured.shipments.push(snapshot);
    }, [snapshot]);
    return (
      <section aria-label="Envio simulado">
        <p>{props.initialShipmentId ?? "Fila completa"}</p>
        <button onClick={() => props.onBusyChange(true)}>
          Iniciar operação
        </button>
        <button onClick={() => props.onBusyChange(false)}>
          Concluir operação
        </button>
      </section>
    );
  },
}));
const admin: User = {
  id: "admin-sales",
  name: "Gestor teste",
  email: "admin@example.com",
  role: "ADMIN",
};
const other: User = {
  ...admin,
  id: "second-admin-sales",
  name: "Gestor dois",
  email: "other@example.com",
};
let restored: User | null;
let notify: (user: User | null) => void;
beforeEach(() => {
  vi.resetAllMocks();
  captured.orders = [];
  captured.shipments = [];
  restored = admin;
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
    if (!restored) throw new Error("Sessão ausente");
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
async function account() {
  render(
    <ShopProvider>
      <AccountActions />
    </ShopProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Gestor" }));
}
async function orders() {
  await account();
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Pedidos e vendas",
    }),
  );
}
const close = () =>
  screen.getByRole<HTMLButtonElement>("button", { name: "Fechar" });
describe("Acesso administrativo a pedidos e vendas", () => {
  it("não expõe o painel a visitantes", () => {
    restored = null;
    render(
      <ShopProvider>
        <AccountActions />
      </ShopProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(
      screen.queryByRole("button", { name: "Pedidos e vendas" }),
    ).toBeNull();
    expect(screen.queryByLabelText("Vendas simuladas")).toBeNull();
    expect(session.authorized).not.toHaveBeenCalled();
  });
  it("não expõe o painel a clientes", async () => {
    restored = { ...admin, role: "CUSTOMER" };
    await account();
    expect(
      screen.queryByRole("button", { name: "Pedidos e vendas" }),
    ).toBeNull();
  });
  it("abre para ADMIN e permite fechar uma consulta sem gravação", async () => {
    await orders();
    expect(
      screen.getByRole("dialog", { name: "Pedidos e vendas" }),
    ).toBeTruthy();
    expect(captured.orders[0].isCurrentSession()).toBe(true);
    expect(
      vi
        .mocked(session.authorized)
        .mock.calls.every(([path]) => path === "/cart"),
    ).toBe(true);
    expect(close().disabled).toBe(false);
    fireEvent.click(close());
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("abre somente o envio escolhido sem iniciar uma operação", async () => {
    await orders();
    fireEvent.click(screen.getByRole("button", { name: "Envio do pedido" }));
    expect(
      screen.getByRole("dialog", { name: "Gestão de envios" }),
    ).toBeTruthy();
    expect(screen.getByText(firstShipment)).toBeTruthy();
    expect(captured.shipments[0].initialShipmentId).toBe(firstShipment);
    expect(close().disabled).toBe(false);
  });
  it("ignora um destino inválido", async () => {
    await orders();
    act(() => captured.orders[0].onOpenShipment?.("01"));
    expect(screen.getByLabelText("Vendas simuladas")).toBeTruthy();
    expect(captured.shipments).toHaveLength(0);
  });
  it("remove o painel e invalida callbacks após perder ADMIN", async () => {
    await orders();
    const old = captured.orders[0];
    act(() => notify({ ...admin, role: "CUSTOMER" }));
    expect(screen.queryByLabelText("Vendas simuladas")).toBeNull();
    expect(old.isCurrentSession()).toBe(false);
    act(() => old.onOpenShipment?.(firstShipment));
    expect(screen.queryByLabelText("Envio simulado")).toBeNull();
  });
  it("descarta filtros e callbacks ao trocar A por B e voltar para A", async () => {
    await orders();
    const old = captured.orders[0];
    fireEvent.change(screen.getByLabelText("Busca particular"), {
      target: { value: "Cliente privado" },
    });
    act(() => notify(other));
    act(() => notify(admin));
    if (!screen.queryByLabelText("Vendas simuladas")) {
      fireEvent.click(screen.getByRole("button", { name: "Pedidos e vendas" }));
    }
    expect(
      screen.getByLabelText<HTMLInputElement>("Busca particular").value,
    ).toBe("");
    expect(old.isCurrentSession()).toBe(false);
    act(() => old.onOpenShipment?.(firstShipment));
    expect(screen.queryByLabelText("Envio simulado")).toBeNull();
  });
  it("um callback antigo não substitui o destino nem desbloqueia outra sessão", async () => {
    await orders();
    const oldOrders = captured.orders[0];
    fireEvent.click(screen.getByRole("button", { name: "Envio do pedido" }));
    const oldShipment = captured.shipments[0];
    act(() => notify(other));
    fireEvent.click(screen.getByRole("button", { name: "Gestor" }));
    fireEvent.click(screen.getByRole("button", { name: "Pedidos e vendas" }));
    const current = captured.orders.at(-1)!;
    act(() => current.onOpenShipment?.(secondShipment));
    fireEvent.click(screen.getByRole("button", { name: "Iniciar operação" }));
    act(() => {
      oldOrders.onOpenShipment?.(firstShipment);
      oldShipment.onBusyChange(false);
    });
    expect(screen.getByText(secondShipment)).toBeTruthy();
    expect(screen.queryByText(firstShipment)).toBeNull();
    expect(close().disabled).toBe(true);
    expect(oldShipment.isCurrentSession()).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Concluir operação" }));
    expect(close().disabled).toBe(false);
  });
  it("a entrada geral de envios limpa o destino que veio de um pedido", async () => {
    await orders();
    fireEvent.click(screen.getByRole("button", { name: "Envio do pedido" }));
    fireEvent.click(close());
    fireEvent.click(screen.getByRole("button", { name: "Gestor" }));
    fireEvent.click(screen.getByRole("button", { name: "Gestão de envios" }));
    expect(screen.getByText("Fila completa")).toBeTruthy();
  });
});
