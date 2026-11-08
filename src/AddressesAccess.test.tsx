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
import { ShopProvider, AccountActions } from "./Shop";
import * as session from "./session";
import type { User } from "./session";

interface AddressPanelProps {
  isCurrentSession: () => boolean;
  onBusyChange: (value: boolean) => void;
}
const panels = vi.hoisted(() => ({
  sequence: 0,
  mounted: [] as Array<{ instance: number; props: AddressPanelProps }>,
  removed: [] as number[],
}));
vi.mock("./session", () => ({
  subscribe: vi.fn(),
  refresh: vi.fn(),
  authorized: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
}));
vi.mock("./AddressesArea", () => ({
  AddressesArea: (props: AddressPanelProps) => {
    const [snapshot] = useState(() => ({ instance: ++panels.sequence, props }));
    const { instance } = snapshot;
    const [draft, setDraft] = useState("");
    useEffect(() => {
      panels.mounted.push(snapshot);
      return () => {
        panels.removed.push(snapshot.instance);
      };
    }, [snapshot]);
    return (
      <section aria-label="Endereços simulados">
        <p>Instância de endereços {instance}</p>
        <label>
          Rascunho de teste
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        <button onClick={() => props.onBusyChange(true)}>
          Iniciar endereço
        </button>
        <button onClick={() => props.onBusyChange(false)}>
          Concluir endereço
        </button>
      </section>
    );
  },
}));

const customer: User = {
  id: "customer-addresses",
  name: "Cliente teste",
  email: "customer@example.com",
  role: "CUSTOMER",
};
const second: User = {
  ...customer,
  id: "other-customer-addresses",
  name: "Outra pessoa",
  email: "other@example.com",
};
let notify: (value: User | null) => void;
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
    return { user: restored, accessToken: "test-token", expiresIn: 900 };
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

async function openAddressBook() {
  const view = render(
    <ShopProvider>
      <AccountActions />
    </ShopProvider>,
  );
  await screen.findByRole("button", { name: "Cliente" });
  fireEvent.click(screen.getByRole("button", { name: "Cliente" }));
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Meus endereços",
    }),
  );
  return view;
}
const closeButton = () =>
  screen.getByRole<HTMLButtonElement>("button", { name: "Fechar" });

describe("Address book access", () => {
  it("asks a signed-out visitor to log in without exposing the address entry", async () => {
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
    expect(screen.queryByRole("button", { name: "Meus endereços" })).toBeNull();
    expect(screen.queryByLabelText("Endereços simulados")).toBeNull();
    expect(session.authorized).not.toHaveBeenCalled();
  });

  it.each(["CUSTOMER", "ADMIN"])(
    "opens account addresses for a %s account",
    async (role) => {
      restored = { ...customer, role };
      await openAddressBook();
      expect(
        screen.getByRole("dialog", { name: "Meus endereços" }),
      ).toBeTruthy();
      expect(screen.getByLabelText("Endereços simulados")).toBeTruthy();
      expect(panels.mounted[0].props.isCurrentSession()).toBe(true);
    },
  );

  it("blocks closing, Escape, cart and notifications while an address mutation runs", async () => {
    await openAddressBook();
    fireEvent.click(screen.getByRole("button", { name: "Iniciar endereço" }));
    expect(closeButton().disabled).toBe(true);
    fireEvent.click(closeButton());
    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { bubbles: true, cancelable: true }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Carrinho/ }));
    fireEvent.click(screen.getByRole("button", { name: "Notificações" }));
    fireEvent.click(screen.getByRole("button", { name: "Cliente" }));
    expect(screen.getByRole("dialog", { name: "Meus endereços" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Concluir endereço" }));
    expect(closeButton().disabled).toBe(false);
    fireEvent.click(closeButton());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("discards a customer's draft and unlocks navigation after logout", async () => {
    await openAddressBook();
    const first = panels.mounted[0];
    fireEvent.change(screen.getByLabelText("Rascunho de teste"), {
      target: { value: "Endereço particular" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Iniciar endereço" }));
    act(() => notify(null));
    expect(
      screen.getByRole("dialog", { name: "Entre na sua jornada" }),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Endereços simulados")).toBeNull();
    expect(panels.removed).toContain(first.instance);
    expect(first.props.isCurrentSession()).toBe(false);
    expect(closeButton().disabled).toBe(false);
    act(() => first.props.onBusyChange(true));
    expect(closeButton().disabled).toBe(false);
  });

  it("mounts a clean book for a different account and ignores the old session's busy callbacks", async () => {
    await openAddressBook();
    const first = panels.mounted[0];
    fireEvent.change(screen.getByLabelText("Rascunho de teste"), {
      target: { value: "Endereço particular" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Iniciar endereço" }));
    act(() => notify(second));
    const next = panels.mounted.at(-1)!;
    expect(next.instance).not.toBe(first.instance);
    expect(first.props.isCurrentSession()).toBe(false);
    expect(next.props.isCurrentSession()).toBe(true);
    expect(
      screen.getByRole<HTMLInputElement>("textbox", {
        name: "Rascunho de teste",
      }).value,
    ).toBe("");
    expect(closeButton().disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Iniciar endereço" }));
    expect(closeButton().disabled).toBe(true);
    act(() => first.props.onBusyChange(false));
    expect(closeButton().disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Concluir endereço" }));
    act(() => first.props.onBusyChange(true));
    expect(closeButton().disabled).toBe(false);
  });

  it("cleans the book when the same account logs out and back in within one render batch", async () => {
    await openAddressBook();
    const first = panels.mounted[0];
    fireEvent.change(screen.getByLabelText("Rascunho de teste"), {
      target: { value: "Endereço particular" },
    });
    act(() => {
      notify(null);
      notify(customer);
    });
    expect(first.props.isCurrentSession()).toBe(false);
    expect(panels.removed).toContain(first.instance);
    fireEvent.click(closeButton());
    fireEvent.click(screen.getByRole("button", { name: "Cliente" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Meus endereços",
      }),
    );
    expect(panels.mounted.at(-1)!.instance).not.toBe(first.instance);
    expect(
      screen.getByRole<HTMLInputElement>("textbox", {
        name: "Rascunho de teste",
      }).value,
    ).toBe("");
    act(() => first.props.onBusyChange(true));
    expect(closeButton().disabled).toBe(false);
  });

  it("replaces the panel generation when account A switches to B and back to A in one batch", async () => {
    await openAddressBook();
    const first = panels.mounted[0];
    fireEvent.change(screen.getByLabelText("Rascunho de teste"), {
      target: { value: "Endereço particular" },
    });
    act(() => {
      notify(second);
      notify(customer);
    });
    expect(panels.mounted.at(-1)!.instance).not.toBe(first.instance);
    expect(first.props.isCurrentSession()).toBe(false);
    expect(
      screen.getByRole<HTMLInputElement>("textbox", {
        name: "Rascunho de teste",
      }).value,
    ).toBe("");
    expect(closeButton().disabled).toBe(false);
  });
});
