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

interface ReferencePanelProps {
  isCurrentSession: () => boolean;
  onBusyChange: (busy: boolean) => void;
  onChanged?: () => void;
}
const panels = vi.hoisted(() => ({
  sequence: 0,
  mounted: [] as Array<{ instance: number; props: ReferencePanelProps }>,
  removed: [] as number[],
}));
vi.mock("./session", () => ({
  subscribe: vi.fn(),
  refresh: vi.fn(),
  authorized: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
}));
vi.mock("./AdminReferencesArea", () => ({
  AdminReferencesArea: (props: ReferencePanelProps) => {
    const [snapshot] = useState(() => ({ instance: ++panels.sequence, props }));
    const [draft, setDraft] = useState("");
    useEffect(() => {
      panels.mounted.push(snapshot);
      return () => {
        panels.removed.push(snapshot.instance);
      };
    }, [snapshot]);
    return (
      <section aria-label="Cadastros simulados">
        <p>Instância de cadastros {snapshot.instance}</p>
        <label>
          Rascunho de cadastro
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        <button onClick={() => props.onBusyChange(true)}>
          Iniciar cadastro
        </button>
        <button onClick={() => props.onBusyChange(false)}>
          Concluir cadastro
        </button>
        <button onClick={props.onChanged}>Atualizar opções da vitrine</button>
      </section>
    );
  },
}));
const admin: User = {
  id: "admin-references",
  name: "Gestor teste",
  email: "admin@example.com",
  role: "ADMIN",
};
const second: User = {
  ...admin,
  id: "other-admin-references",
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
async function openReferences() {
  await openAccount();
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Cadastros da loja",
    }),
  );
}
const closeButton = () =>
  screen.getByRole<HTMLButtonElement>("button", { name: "Fechar" });
describe("Reference management access", () => {
  it("does not expose management to a signed-out visitor", () => {
    restored = null;
    render(
      <ShopProvider>
        <AccountActions />
      </ShopProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(
      screen.getByRole("dialog", { name: "Entre na sua conta" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Cadastros da loja" }),
    ).toBeNull();
    expect(screen.queryByLabelText("Cadastros simulados")).toBeNull();
    expect(session.authorized).not.toHaveBeenCalled();
  });
  it("hides management from a customer account", async () => {
    restored = { ...admin, role: "CUSTOMER" };
    await openAccount();
    expect(
      screen.queryByRole("button", { name: "Cadastros da loja" }),
    ).toBeNull();
    expect(screen.queryByLabelText("Cadastros simulados")).toBeNull();
  });
  it("opens management for an administrator without making writes", async () => {
    await openReferences();
    expect(
      screen.getByRole("dialog", { name: "Cadastros da loja" }),
    ).toBeTruthy();
    expect(screen.getByLabelText("Cadastros simulados")).toBeTruthy();
    expect(panels.mounted[0].props.isCurrentSession()).toBe(true);
    expect(
      vi
        .mocked(session.authorized)
        .mock.calls.every(([path]) => path === "/cart"),
    ).toBe(true);
  });
  it("locks close, Escape, cart, notifications and account navigation while saving", async () => {
    await openReferences();
    fireEvent.click(screen.getByRole("button", { name: "Iniciar cadastro" }));
    expect(closeButton().disabled).toBe(true);
    fireEvent.click(closeButton());
    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { bubbles: true, cancelable: true }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Carrinho/ }));
    fireEvent.click(screen.getByRole("button", { name: "Notificações" }));
    fireEvent.click(screen.getByRole("button", { name: "Gestor" }));
    expect(
      screen.getByRole("dialog", { name: "Cadastros da loja" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Concluir cadastro" }));
    expect(closeButton().disabled).toBe(false);
    fireEvent.click(closeButton());
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("discards management and old busy callbacks after the administrator role is revoked", async () => {
    await openReferences();
    const old = panels.mounted[0];
    fireEvent.change(screen.getByLabelText("Rascunho de cadastro"), {
      target: { value: "Categoria particular" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Iniciar cadastro" }));
    act(() => notify({ ...admin, role: "CUSTOMER" }));
    expect(screen.getByRole("dialog", { name: "Minha conta" })).toBeTruthy();
    expect(screen.queryByLabelText("Cadastros simulados")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Cadastros da loja" }),
    ).toBeNull();
    expect(old.props.isCurrentSession()).toBe(false);
    expect(panels.removed).toContain(old.instance);
    act(() => old.props.onBusyChange(true));
    expect(closeButton().disabled).toBe(false);
  });
  it("cleans management and unlocks navigation after logout", async () => {
    await openReferences();
    const old = panels.mounted[0];
    fireEvent.click(screen.getByRole("button", { name: "Iniciar cadastro" }));
    act(() => notify(null));
    expect(
      screen.getByRole("dialog", { name: "Entre na sua conta" }),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Cadastros simulados")).toBeNull();
    expect(old.props.isCurrentSession()).toBe(false);
    act(() => old.props.onBusyChange(true));
    expect(closeButton().disabled).toBe(false);
  });
  it("replaces the draft and rejects old callbacks after another administrator signs in", async () => {
    await openReferences();
    const old = panels.mounted[0];
    fireEvent.change(screen.getByLabelText("Rascunho de cadastro"), {
      target: { value: "Categoria antiga" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Iniciar cadastro" }));
    act(() => notify(second));
    expect(panels.mounted.at(-1)!.instance).not.toBe(old.instance);
    expect(
      (screen.getByLabelText("Rascunho de cadastro") as HTMLInputElement).value,
    ).toBe("");
    expect(old.props.isCurrentSession()).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Iniciar cadastro" }));
    act(() => old.props.onBusyChange(false));
    expect(closeButton().disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Concluir cadastro" }));
    act(() => old.props.onBusyChange(true));
    expect(closeButton().disabled).toBe(false);
  });
  it("invalidates the old generation after same-account logout and login in a single batch", async () => {
    await openReferences();
    const old = panels.mounted[0];
    act(() => {
      notify(null);
      notify(admin);
    });
    expect(old.props.isCurrentSession()).toBe(false);
    expect(panels.removed).toContain(old.instance);
    fireEvent.click(closeButton());
    fireEvent.click(screen.getByRole("button", { name: "Gestor" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cadastros da loja",
      }),
    );
    expect(panels.mounted.at(-1)!.instance).not.toBe(old.instance);
    act(() => old.props.onBusyChange(true));
    expect(closeButton().disabled).toBe(false);
  });
  it("replaces management when account A switches to B and back to A in a single batch", async () => {
    await openReferences();
    const old = panels.mounted[0];
    fireEvent.change(screen.getByLabelText("Rascunho de cadastro"), {
      target: { value: "Rascunho antigo" },
    });
    act(() => {
      notify(second);
      notify(admin);
    });
    expect(panels.mounted.at(-1)!.instance).not.toBe(old.instance);
    expect(old.props.isCurrentSession()).toBe(false);
    expect(
      (screen.getByLabelText("Rascunho de cadastro") as HTMLInputElement).value,
    ).toBe("");
  });
  it("notifies the storefront only for the current administrator generation", async () => {
    const changed = vi.fn();
    window.addEventListener("jornada-catalog-changed", changed);
    try {
      await openReferences();
      const old = panels.mounted[0];
      fireEvent.click(
        screen.getByRole("button", { name: "Atualizar opções da vitrine" }),
      );
      expect(changed).toHaveBeenCalledTimes(1);
      act(() => notify({ ...admin, role: "CUSTOMER" }));
      act(() => old.props.onChanged?.());
      expect(changed).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("jornada-catalog-changed", changed);
    }
  });
});
