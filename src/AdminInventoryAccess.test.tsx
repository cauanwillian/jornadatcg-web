// @vitest-environment jsdom
import { useEffect, useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountActions, ShopProvider } from "./Shop";
import * as session from "./session";
import type { User } from "./session";

interface InventoryProps {
  isCurrentSession: () => boolean;
  onOpenProduct?: (id: string) => void;
  onOpenHistory?: (id: string) => void;
}
interface ProductProps {
  isCurrentSession: () => boolean;
  onBusyChange: (busy: boolean) => void;
  onChanged?: () => void;
  initialProductId?: string;
  onOpenHistory?: (id: string) => void;
}
const captured = vi.hoisted(() => ({
  inventories: [] as InventoryProps[],
  products: [] as ProductProps[],
  histories: [] as Array<{
    isCurrentSession: () => boolean;
    initialProductId?: string;
  }>,
}));
const productId = "1dc068c0-d16d-4081-9d00-a73707709887";
const secondId = "2dc068c0-d16d-4081-9d00-a73707709887";
vi.mock("./session", () => ({
  subscribe: vi.fn(),
  refresh: vi.fn(),
  authorized: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  invalidateSession: vi.fn(),
}));
vi.mock("./AdminInventoryArea", () => ({
  AdminInventoryArea: (props: InventoryProps) => {
    const [snapshot] = useState(() => props);
    const [draft, setDraft] = useState("");
    useEffect(() => {
      captured.inventories.push(snapshot);
    }, [snapshot]);
    return (
      <section aria-label="Estoque simulado">
        <label>
          Busca particular
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        <button onClick={() => props.onOpenProduct?.(productId)}>
          Abrir produto do estoque
        </button>
        <button onClick={() => props.onOpenHistory?.(productId)}>
          Histórico do produto
        </button>
      </section>
    );
  },
}));
vi.mock("./AdminArea", () => ({
  AdminPanel: (props: ProductProps) => {
    const [snapshot] = useState(() => props);
    useEffect(() => {
      captured.products.push(snapshot);
    }, [snapshot]);
    return (
      <section aria-label="Produto simulado">
        <p>{props.initialProductId ?? "Lista completa"}</p>
        <button onClick={() => props.onBusyChange(true)}>Iniciar ajuste</button>
        <button onClick={() => props.onBusyChange(false)}>
          Concluir ajuste
        </button>
        <button onClick={props.onChanged}>Avisar atualização</button>
        <button onClick={() => props.onOpenHistory?.(productId)}>
          Histórico no cadastro
        </button>
      </section>
    );
  },
}));
vi.mock("./StockMovementsArea", () => ({
  StockMovementsArea: (props: {
    isCurrentSession: () => boolean;
    initialProductId?: string;
  }) => {
    const [snapshot] = useState(() => props);
    useEffect(() => {
      captured.histories.push(snapshot);
    }, [snapshot]);
    return (
      <section aria-label="Histórico simulado">
        <p>{props.initialProductId ?? "Histórico geral"}</p>
      </section>
    );
  },
}));
const admin: User = {
  id: "admin-inventory",
  name: "Gestor teste",
  email: "admin@example.com",
  role: "ADMIN",
};
const other: User = {
  ...admin,
  id: "other-admin-inventory",
  name: "Gestor dois",
  email: "other@example.com",
};
let restored: User | null;
let notify: (user: User | null) => void;
beforeEach(() => {
  vi.resetAllMocks();
  captured.inventories = [];
  captured.products = [];
  captured.histories = [];
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
async function inventory() {
  await account();
  fireEvent.click(screen.getByRole("button", { name: "Visão de estoque" }));
}
const close = () =>
  screen.getByRole<HTMLButtonElement>("button", { name: "Fechar" });
describe("Acesso administrativo à visão de estoque", () => {
  it("abre histórico geral pela conta e mantém fechamento disponível", async () => {
    await account();
    fireEvent.click(
      screen.getByRole("button", { name: "Histórico de estoque" }),
    );
    expect(await screen.findByText("Histórico geral")).toBeTruthy();
    expect(captured.histories[0].isCurrentSession()).toBe(true);
    expect(close().disabled).toBe(false);
  });
  it("abre o histórico do produto a partir do estoque e do cadastro", async () => {
    await inventory();
    fireEvent.click(
      screen.getByRole("button", { name: "Histórico do produto" }),
    );
    await screen.findByLabelText("Histórico simulado");
    expect(captured.histories[0].initialProductId).toBe(productId);
    fireEvent.click(close());
    fireEvent.click(screen.getByRole("button", { name: "Gestor" }));
    fireEvent.click(screen.getByRole("button", { name: "Gestão de produtos" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Histórico no cadastro" }),
    );
    expect(captured.histories.at(-1)?.initialProductId).toBe(productId);
  });
  it("limpa o escopo ao abrir o histórico geral após consultar um produto", async () => {
    await inventory();
    fireEvent.click(
      screen.getByRole("button", { name: "Histórico do produto" }),
    );
    fireEvent.click(close());
    fireEvent.click(screen.getByRole("button", { name: "Gestor" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Histórico de estoque" }),
    );
    expect(screen.getByText("Histórico geral")).toBeTruthy();
  });
  it("revoga histórico e escopo anterior na troca A para B para A", async () => {
    await inventory();
    fireEvent.click(
      screen.getByRole("button", { name: "Histórico do produto" }),
    );
    await screen.findByLabelText("Histórico simulado");
    const old = captured.histories[0];
    act(() => notify(other));
    act(() => notify(admin));
    expect(old.isCurrentSession()).toBe(false);
    expect(captured.histories.at(-1)?.initialProductId).toBeUndefined();
    act(() => notify({ ...admin, role: "CUSTOMER" }));
    expect(screen.queryByLabelText("Histórico simulado")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Histórico de estoque" }),
    ).toBeNull();
  });
  it("não aceita destino inválido ou callbacks antigos para o histórico", async () => {
    await inventory();
    const old = captured.inventories[0];
    act(() => old.onOpenHistory?.("01"));
    expect(captured.histories).toHaveLength(0);
    act(() => notify(other));
    act(() => old.onOpenHistory?.(productId));
    expect(captured.histories).toHaveLength(0);
  });
  it("não oferece o painel a visitantes", () => {
    restored = null;
    render(
      <ShopProvider>
        <AccountActions />
      </ShopProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(
      screen.queryByRole("button", { name: "Visão de estoque" }),
    ).toBeNull();
    expect(session.authorized).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Histórico de estoque" }),
    ).toBeNull();
  });
  it("não oferece o painel a clientes", async () => {
    restored = { ...admin, role: "CUSTOMER" };
    await account();
    expect(
      screen.queryByRole("button", { name: "Visão de estoque" }),
    ).toBeNull();
  });
  it("abre a consulta para ADMIN sem bloquear o fechamento ou gravar", async () => {
    await inventory();
    expect(
      screen.getByRole("dialog", { name: "Visão de estoque" }),
    ).toBeTruthy();
    expect(captured.inventories[0].isCurrentSession()).toBe(true);
    expect(
      vi
        .mocked(session.authorized)
        .mock.calls.every(([path]) => path === "/cart"),
    ).toBe(true);
    expect(close().disabled).toBe(false);
    fireEvent.click(close());
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("abre o produto escolhido sem iniciar alteração", async () => {
    await inventory();
    fireEvent.click(
      screen.getByRole("button", { name: "Abrir produto do estoque" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Gestão de produtos" }),
    ).toBeTruthy();
    expect(captured.products[0].initialProductId).toBe(productId);
    expect(close().disabled).toBe(false);
  });
  it("recusa destinos inválidos", async () => {
    await inventory();
    act(() => captured.inventories[0].onOpenProduct?.("01"));
    expect(screen.getByLabelText("Estoque simulado")).toBeTruthy();
    expect(captured.products).toHaveLength(0);
  });
  it("revoga acesso e navegação após perder ADMIN", async () => {
    await inventory();
    const old = captured.inventories[0];
    act(() => notify({ ...admin, role: "CUSTOMER" }));
    expect(old.isCurrentSession()).toBe(false);
    expect(screen.queryByLabelText("Estoque simulado")).toBeNull();
    act(() => old.onOpenProduct?.(productId));
    expect(screen.queryByLabelText("Produto simulado")).toBeNull();
  });
  it("descarta rascunho e callback ao trocar A por B e voltar para A", async () => {
    await inventory();
    const old = captured.inventories[0];
    fireEvent.change(screen.getByLabelText("Busca particular"), {
      target: { value: "Anúncio privado" },
    });
    act(() => notify(other));
    act(() => notify(admin));
    expect(
      screen.getByLabelText<HTMLInputElement>("Busca particular").value,
    ).toBe("");
    expect(old.isCurrentSession()).toBe(false);
    act(() => old.onOpenProduct?.(productId));
    expect(screen.queryByLabelText("Produto simulado")).toBeNull();
  });
  it("callbacks antigos não alteram outro produto nem desbloqueiam ajustes de outra sessão", async () => {
    await inventory();
    const oldInventory = captured.inventories[0];
    fireEvent.click(
      screen.getByRole("button", { name: "Abrir produto do estoque" }),
    );
    const oldProduct = captured.products[0];
    act(() => notify(other));
    fireEvent.click(screen.getByRole("button", { name: "Gestor" }));
    fireEvent.click(screen.getByRole("button", { name: "Visão de estoque" }));
    act(() => captured.inventories.at(-1)!.onOpenProduct?.(secondId));
    const changed = vi.fn();
    window.addEventListener("jornada-catalog-changed", changed);
    try {
      fireEvent.click(screen.getByRole("button", { name: "Iniciar ajuste" }));
      act(() => {
        oldInventory.onOpenProduct?.(productId);
        oldProduct.onBusyChange(false);
        oldProduct.onChanged?.();
      });
      expect(screen.getByText(secondId)).toBeTruthy();
      expect(close().disabled).toBe(true);
      expect(oldProduct.isCurrentSession()).toBe(false);
      expect(changed).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Concluir ajuste" }));
      expect(close().disabled).toBe(false);
      fireEvent.click(
        screen.getByRole("button", { name: "Avisar atualização" }),
      );
      expect(changed).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener("jornada-catalog-changed", changed);
    }
  });
  it("a entrada geral de produtos descarta o destino vindo do estoque", async () => {
    await inventory();
    fireEvent.click(
      screen.getByRole("button", { name: "Abrir produto do estoque" }),
    );
    fireEvent.click(close());
    fireEvent.click(screen.getByRole("button", { name: "Gestor" }));
    fireEvent.click(screen.getByRole("button", { name: "Gestão de produtos" }));
    expect(screen.getByText("Lista completa")).toBeTruthy();
  });
});
