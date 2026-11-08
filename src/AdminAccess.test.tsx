// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShopProvider, AccountActions } from "./Shop";
import * as session from "./session";
import type { User } from "./session";

vi.mock("./session", () => ({
  subscribe: vi.fn(),
  refresh: vi.fn(),
  authorized: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
}));
vi.mock("./AdminArea", () => ({
  AdminPanel: (props: {
    onBusyChange: (busy: boolean) => void;
    onChanged: () => void;
  }) => {
    return (
      <section aria-label="Painel administrativo simulado">
        <button onClick={() => props.onBusyChange(true)}>
          Iniciar alteração
        </button>
        <button onClick={() => props.onBusyChange(false)}>
          Concluir alteração
        </button>
        <button onClick={props.onChanged}>Atualizar vitrine</button>
      </section>
    );
  },
}));
vi.mock("./AdminBannersArea", () => ({
  BannerPanel: (props: {
    onBusyChange: (busy: boolean) => void;
    onChanged: () => void;
  }) => (
    <section aria-label="Painel de banners simulado">
      <button onClick={() => props.onBusyChange(true)}>Iniciar upload</button>
      <button onClick={() => props.onBusyChange(false)}>Concluir upload</button>
      <button onClick={props.onChanged}>Atualizar banners da vitrine</button>
    </section>
  ),
}));
vi.mock("./AdminShipmentsArea", () => ({
  ShipmentManagement: (props: {
    onBusyChange: (busy: boolean) => void;
  }) => (
    <section aria-label="Painel de envios simulado">
      <button onClick={() => props.onBusyChange(true)}>
        Iniciar operação de envio
      </button>
      <button onClick={() => props.onBusyChange(false)}>
        Concluir operação de envio
      </button>
    </section>
  ),
}));
const admin: User = {
  id: "admin-user",
  name: "Admin teste",
  email: "admin@example.com",
  role: "ADMIN",
};
let notify: (user: User | null) => void;
let restored: User;
beforeEach(() => {
  vi.resetAllMocks();
  restored = admin;
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
    notify(restored);
    return { accessToken: "test", user: restored, expiresIn: 900 };
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
  await screen.findByRole("button", { name: "Admin" });
  fireEvent.click(screen.getByRole("button", { name: "Admin" }));
}
describe("Administrative access", () => {
  it("hides the administrative entry from a customer", async () => {
    restored = { ...admin, role: "CUSTOMER" };
    await openAccount();
    expect(
      screen.queryByRole("button", { name: "Gestão de produtos" }),
    ).toBeNull();
    expect(
      screen.queryByLabelText("Painel administrativo simulado"),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Gestão de banners" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Gestão de envios" }),
    ).toBeNull();
    expect(screen.queryByLabelText("Painel de envios simulado")).toBeNull();
  });
  it("opens the admin area and prevents closing or changing panels during a mutation", async () => {
    await openAccount();
    fireEvent.click(screen.getByRole("button", { name: "Gestão de produtos" }));
    const dialog = screen.getByRole("dialog", { name: "Gestão de produtos" });
    fireEvent.click(screen.getByRole("button", { name: "Iniciar alteração" }));
    expect(
      (screen.getByRole("button", { name: "Fechar" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
    fireEvent.click(screen.getByRole("button", { name: /Carrinho/ }));
    expect(
      screen.getByRole("dialog", { name: "Gestão de produtos" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Concluir alteração" }));
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("closes admin management if the same user's role is revoked", async () => {
    await openAccount();
    fireEvent.click(screen.getByRole("button", { name: "Gestão de produtos" }));
    fireEvent.click(screen.getByRole("button", { name: "Iniciar alteração" }));
    act(() => notify({ ...admin, role: "CUSTOMER" }));
    expect(screen.getByRole("dialog", { name: "Minha conta" })).toBeTruthy();
    expect(
      screen.queryByLabelText("Painel administrativo simulado"),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Gestão de produtos" }),
    ).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Fechar" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
  it("notifies the storefront after a confirmed management change", async () => {
    const changed = vi.fn();
    window.addEventListener("jornada-catalog-changed", changed);
    try {
      await openAccount();
      fireEvent.click(
        screen.getByRole("button", { name: "Gestão de produtos" }),
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Atualizar vitrine" }),
      );
      expect(changed).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("jornada-catalog-changed", changed);
    }
  });
  it("opens banner management and locks navigation during an upload", async () => {
    await openAccount();
    fireEvent.click(screen.getByRole("button", { name: "Gestão de banners" }));
    const dialog = screen.getByRole("dialog", { name: "Gestão de banners" });
    fireEvent.click(screen.getByRole("button", { name: "Iniciar upload" }));
    expect(
      (screen.getByRole("button", { name: "Fechar" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
    fireEvent.click(screen.getByRole("button", { name: /Carrinho/ }));
    expect(
      screen.getByRole("dialog", { name: "Gestão de banners" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Concluir upload" }));
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("discards banner management when the admin role is revoked", async () => {
    await openAccount();
    fireEvent.click(screen.getByRole("button", { name: "Gestão de banners" }));
    fireEvent.click(screen.getByRole("button", { name: "Iniciar upload" }));
    act(() => notify({ ...admin, role: "CUSTOMER" }));
    expect(screen.getByRole("dialog", { name: "Minha conta" })).toBeTruthy();
    expect(screen.queryByLabelText("Painel de banners simulado")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Gestão de banners" }),
    ).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Fechar" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
  it("notifies the storefront after a confirmed banner change", async () => {
    const changed = vi.fn();
    window.addEventListener("jornada-catalog-changed", changed);
    try {
      await openAccount();
      fireEvent.click(
        screen.getByRole("button", { name: "Gestão de banners" }),
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Atualizar banners da vitrine" }),
      );
      expect(changed).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("jornada-catalog-changed", changed);
    }
  });
  it("opens shipment management and prevents navigation or closing during an operation", async () => {
    await openAccount();
    fireEvent.click(screen.getByRole("button", { name: "Gestão de envios" }));
    const dialog = screen.getByRole("dialog", { name: "Gestão de envios" });
    expect(screen.getByLabelText("Painel de envios simulado")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Iniciar operação de envio" }));
    expect(
      (screen.getByRole("button", { name: "Fechar" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
    fireEvent.click(screen.getByRole("button", { name: /Carrinho/ }));
    fireEvent.click(screen.getByRole("button", { name: "Admin" }));
    expect(screen.getByRole("dialog", { name: "Gestão de envios" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Concluir operação de envio" }));
    expect(
      (screen.getByRole("button", { name: "Fechar" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("discards shipment management and releases navigation when the admin role is revoked", async () => {
    await openAccount();
    fireEvent.click(screen.getByRole("button", { name: "Gestão de envios" }));
    fireEvent.click(screen.getByRole("button", { name: "Iniciar operação de envio" }));
    act(() => notify({ ...admin, role: "CUSTOMER" }));
    expect(screen.getByRole("dialog", { name: "Minha conta" })).toBeTruthy();
    expect(screen.queryByLabelText("Painel de envios simulado")).toBeNull();
    expect(screen.queryByRole("button", { name: "Gestão de envios" })).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Fechar" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
});
