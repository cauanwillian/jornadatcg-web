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

interface CardsPanelProps {
  isCurrentSession: () => boolean;
  onBusyChange: (busy: boolean) => void;
  onOpenProducts: () => void;
}
const panels = vi.hoisted(() => ({
  sequence: 0,
  mounted: [] as Array<{ instance: number; props: CardsPanelProps }>,
  removed: [] as number[],
}));
vi.mock("./session", () => ({
  subscribe: vi.fn(),
  refresh: vi.fn(),
  authorized: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
}));
vi.mock("./AdminCardsArea", () => ({
  AdminCardsArea: (props: CardsPanelProps) => {
    const [snapshot] = useState(() => ({ instance: ++panels.sequence, props }));
    const [draft, setDraft] = useState("");
    useEffect(() => {
      panels.mounted.push(snapshot);
      return () => {
        panels.removed.push(snapshot.instance);
      };
    }, [snapshot]);
    return (
      <section aria-label="Biblioteca simulada">
        <p>Instância de cartas {snapshot.instance}</p>
        <label>
          Pesquisa de carta
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        <button onClick={() => props.onBusyChange(true)}>
          Iniciar importação
        </button>
        <button onClick={() => props.onBusyChange(false)}>
          Concluir importação
        </button>
        <button onClick={props.onOpenProducts}>Abrir anúncios</button>
      </section>
    );
  },
}));
vi.mock("./AdminArea", () => ({
  AdminPanel: (props: { onBusyChange: (busy: boolean) => void }) => (
    <section aria-label="Anúncios simulados">
      <button onClick={() => props.onBusyChange(true)}>Iniciar anúncio</button>
      <button onClick={() => props.onBusyChange(false)}>
        Concluir anúncio
      </button>
    </section>
  ),
}));
const admin: User = {
  id: "admin-cards",
  name: "Gestor teste",
  email: "admin@example.com",
  role: "ADMIN",
};
const second: User = {
  ...admin,
  id: "other-admin-cards",
  name: "Outro gestor",
  email: "other@example.com",
};
let notify: (user: User | null) => void;
let restored: User | null;
beforeEach(() => {
  vi.resetAllMocks();
  panels.sequence = 0;
  panels.mounted = [];
  panels.removed = [];
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
async function openAccount() {
  render(
    <ShopProvider>
      <AccountActions />
    </ShopProvider>,
  );
  await screen.findByRole("button", { name: "Gestor" });
  fireEvent.click(screen.getByRole("button", { name: "Gestor" }));
}
async function openLibrary() {
  await openAccount();
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Biblioteca de cartas",
    }),
  );
}
const closeButton = () =>
  screen.getByRole<HTMLButtonElement>("button", { name: "Fechar" });

describe("Card library administrative access", () => {
  it("does not expose the library to a signed-out visitor", () => {
    restored = null;
    render(
      <ShopProvider>
        <AccountActions />
      </ShopProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(
      screen.getByRole("dialog", { name: "Entre na sua jornada" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Biblioteca de cartas" }),
    ).toBeNull();
    expect(screen.queryByLabelText("Biblioteca simulada")).toBeNull();
    expect(session.authorized).not.toHaveBeenCalled();
  });
  it("hides the library from customers", async () => {
    restored = { ...admin, role: "CUSTOMER" };
    await openAccount();
    expect(
      screen.queryByRole("button", { name: "Biblioteca de cartas" }),
    ).toBeNull();
    expect(screen.queryByLabelText("Biblioteca simulada")).toBeNull();
  });
  it("opens the library for ADMIN without creating cards or products", async () => {
    await openLibrary();
    expect(
      screen.getByRole("dialog", { name: "Biblioteca de cartas" }),
    ).toBeTruthy();
    expect(screen.getByLabelText("Biblioteca simulada")).toBeTruthy();
    expect(panels.mounted[0].props.isCurrentSession()).toBe(true);
    expect(
      vi
        .mocked(session.authorized)
        .mock.calls.every(([path]) => path === "/cart"),
    ).toBe(true);
  });
  it("blocks close, Escape, cart, account, notifications and product navigation during import", async () => {
    await openLibrary();
    fireEvent.click(screen.getByRole("button", { name: "Iniciar importação" }));
    expect(closeButton().disabled).toBe(true);
    fireEvent.click(closeButton());
    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { bubbles: true, cancelable: true }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Carrinho/ }));
    fireEvent.click(screen.getByRole("button", { name: "Notificações" }));
    fireEvent.click(screen.getByRole("button", { name: "Gestor" }));
    fireEvent.click(screen.getByRole("button", { name: "Abrir anúncios" }));
    expect(
      screen.getByRole("dialog", { name: "Biblioteca de cartas" }),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Anúncios simulados")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Concluir importação" }),
    );
    expect(closeButton().disabled).toBe(false);
    fireEvent.click(closeButton());
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("opens product management only after an explicit action by the current administrator", async () => {
    await openLibrary();
    expect(screen.queryByLabelText("Anúncios simulados")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Abrir anúncios" }));
    expect(
      screen.getByRole("dialog", { name: "Gestão de produtos" }),
    ).toBeTruthy();
    expect(screen.getByLabelText("Anúncios simulados")).toBeTruthy();
    expect(screen.queryByLabelText("Biblioteca simulada")).toBeNull();
  });
  it("removes the library and invalidates callbacks when ADMIN is revoked", async () => {
    await openLibrary();
    const old = panels.mounted[0];
    fireEvent.change(screen.getByLabelText("Pesquisa de carta"), {
      target: { value: "Pesquisa particular" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Iniciar importação" }));
    act(() => notify({ ...admin, role: "CUSTOMER" }));
    expect(screen.getByRole("dialog", { name: "Minha conta" })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Biblioteca de cartas" }),
    ).toBeNull();
    expect(screen.queryByLabelText("Biblioteca simulada")).toBeNull();
    expect(old.props.isCurrentSession()).toBe(false);
    expect(panels.removed).toContain(old.instance);
    act(() => {
      old.props.onBusyChange(true);
      old.props.onOpenProducts();
    });
    expect(closeButton().disabled).toBe(false);
    expect(screen.getByRole("dialog", { name: "Minha conta" })).toBeTruthy();
    expect(screen.queryByLabelText("Anúncios simulados")).toBeNull();
  });
  it("clears the library and releases the navigation lock after logout", async () => {
    await openLibrary();
    const old = panels.mounted[0];
    fireEvent.click(screen.getByRole("button", { name: "Iniciar importação" }));
    act(() => notify(null));
    expect(
      screen.getByRole("dialog", { name: "Entre na sua jornada" }),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Biblioteca simulada")).toBeNull();
    expect(old.props.isCurrentSession()).toBe(false);
    act(() => {
      old.props.onBusyChange(true);
      old.props.onOpenProducts();
    });
    expect(closeButton().disabled).toBe(false);
    expect(
      screen.getByRole("dialog", { name: "Entre na sua jornada" }),
    ).toBeTruthy();
  });
  it("replaces private search state when another administrator signs in", async () => {
    await openLibrary();
    const old = panels.mounted[0];
    fireEvent.change(screen.getByLabelText("Pesquisa de carta"), {
      target: { value: "Pesquisa antiga" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Iniciar importação" }));
    act(() => notify(second));
    expect(panels.mounted.at(-1)!.instance).not.toBe(old.instance);
    expect(
      (screen.getByLabelText("Pesquisa de carta") as HTMLInputElement).value,
    ).toBe("");
    expect(old.props.isCurrentSession()).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Iniciar importação" }));
    act(() => old.props.onBusyChange(false));
    expect(closeButton().disabled).toBe(true);
    fireEvent.click(
      screen.getByRole("button", { name: "Concluir importação" }),
    );
    act(() => old.props.onBusyChange(true));
    expect(closeButton().disabled).toBe(false);
  });
  it("rejects stale navigation callbacks from a previous administrator", async () => {
    await openLibrary();
    const old = panels.mounted[0];
    act(() => notify(second));
    act(() => old.props.onOpenProducts());
    expect(
      screen.getByRole("dialog", { name: "Biblioteca de cartas" }),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Anúncios simulados")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Abrir anúncios" }));
    expect(
      screen.getByRole("dialog", { name: "Gestão de produtos" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Iniciar anúncio" }));
    act(() => {
      old.props.onBusyChange(false);
      old.props.onOpenProducts();
    });
    expect(closeButton().disabled).toBe(true);
    expect(screen.getByLabelText("Anúncios simulados")).toBeTruthy();
  });
  it("invalidates the previous generation after same-account logout and login in one batch", async () => {
    await openLibrary();
    const old = panels.mounted[0];
    act(() => {
      notify(null);
      notify(admin);
    });
    expect(old.props.isCurrentSession()).toBe(false);
    expect(panels.removed).toContain(old.instance);
    act(() => {
      old.props.onBusyChange(true);
      old.props.onOpenProducts();
    });
    expect(
      screen.getByRole("dialog", { name: "Entre na sua jornada" }),
    ).toBeTruthy();
    expect(closeButton().disabled).toBe(false);
  });
  it("replaces the draft and callbacks after account A switches to B and back to A in one batch", async () => {
    await openLibrary();
    const old = panels.mounted[0];
    fireEvent.change(screen.getByLabelText("Pesquisa de carta"), {
      target: { value: "Rascunho antigo" },
    });
    act(() => {
      notify(second);
      notify(admin);
    });
    expect(panels.mounted.at(-1)!.instance).not.toBe(old.instance);
    expect(old.props.isCurrentSession()).toBe(false);
    expect(
      (screen.getByLabelText("Pesquisa de carta") as HTMLInputElement).value,
    ).toBe("");
    act(() => {
      old.props.onBusyChange(true);
      old.props.onOpenProducts();
    });
    expect(closeButton().disabled).toBe(false);
    expect(
      screen.getByRole("dialog", { name: "Biblioteca de cartas" }),
    ).toBeTruthy();
  });
});
