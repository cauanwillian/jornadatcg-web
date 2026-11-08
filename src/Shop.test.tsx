// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import {
  render,
  fireEvent,
  screen,
  waitFor,
  cleanup,
  act,
} from "@testing-library/react";
import { ShopProvider, AccountActions, AddButton } from "./Shop";
import * as session from "./session";
import * as registration from "./registration";
import type { Order } from "./purchase";
vi.mock("./session", () => ({
  subscribe: vi.fn(),
  refresh: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  authorized: vi.fn(),
}));
vi.mock("./registration", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./registration")>()),
  registerCustomer: vi.fn(),
}));
const user = {
  id: "user",
  name: "Test",
  email: "test@example.com",
  role: "CUSTOMER",
};
const cart = {
  items: [
    {
      productId: "p",
      quantity: 2,
      availableQuantity: 5,
      available: true,
      card: { name: "Pikachu" },
      unitPrice: "10.00",
      subtotal: "20.00",
    },
  ],
  summary: { totalQuantity: 2, subtotal: "20.00" },
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function restoreSession() {
  vi.mocked(session.refresh).mockImplementation(async () => {
    notify(user);
    return { accessToken: "a", user, expiresIn: 900 };
  });
}
function renderShop() {
  return render(
    <ShopProvider>
      <AccountActions />
      <AddButton id="p" available />
    </ShopProvider>,
  );
}
let notify: (u: typeof user | null) => void;
beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  HTMLDialogElement.prototype.showModal = vi.fn(function (
    this: HTMLDialogElement,
  ) {
    this.open = true;
  });
  vi.mocked(session.subscribe).mockImplementation((fn) => {
    notify = fn;
    return () => {};
  });
  vi.mocked(session.refresh).mockResolvedValue({
    accessToken: "a",
    user,
    expiresIn: 900,
  });
  vi.mocked(session.authorized).mockResolvedValue(cart);
});
afterEach(cleanup);
describe("Login and cart UI", () => {
  async function openRegistration() {
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    fireEvent.click(screen.getByRole("button", { name: "Criar conta" }));
    await screen.findByRole("dialog", { name: "Crie sua conta" });
    fireEvent.change(screen.getByLabelText("Nome"), {
      target: { value: "Nova cliente" },
    });
    fireEvent.change(screen.getByLabelText("E-mail"), {
      target: { value: "new@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Senha"), {
      target: { value: "uma senha longa" },
    });
    fireEvent.change(screen.getByLabelText("Confirmar senha"), {
      target: { value: "uma senha longa" },
    });
  }
  const registered = {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Nova cliente",
    email: "new@example.com",
    role: "CUSTOMER" as const,
  };
  it("returns a new customer to login with their email and connects the cart only after login", async () => {
    vi.mocked(registration.registerCustomer).mockResolvedValue(registered);
    vi.mocked(session.login).mockImplementation(async () => {
      notify(registered);
      return { accessToken: "new-session", user: registered, expiresIn: 900 };
    });
    renderShop();
    await openRegistration();
    fireEvent.submit(screen.getByLabelText("Senha").closest("form")!);
    await screen.findByRole("dialog", { name: "Entre na sua jornada" });
    expect(screen.getByRole("status").textContent).toContain("Conta criada!");
    expect((screen.getByLabelText("E-mail") as HTMLInputElement).value).toBe(
      registered.email,
    );
    expect((screen.getByLabelText("Senha") as HTMLInputElement).value).toBe("");
    expect(session.login).not.toHaveBeenCalled();
    expect(session.authorized).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Senha"), {
      target: { value: "uma senha longa" },
    });
    fireEvent.submit(screen.getByLabelText("Senha").closest("form")!);
    await screen.findByRole("dialog", { name: "Seu carrinho" });
    expect(session.login).toHaveBeenCalledWith(
      registered.email,
      "uma senha longa",
    );
    expect(session.authorized).toHaveBeenCalledWith("/cart");
  });
  it("keeps registration open during initial signed-out refresh and blocks close or navigation while posting", async () => {
    const creation = deferred<typeof registered>();
    vi.mocked(registration.registerCustomer).mockReturnValue(creation.promise);
    renderShop();
    await openRegistration();
    act(() => notify(null));
    expect(screen.getByRole("dialog", { name: "Crie sua conta" })).toBeTruthy();
    const form = screen.getByLabelText("Senha").closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(registration.registerCustomer).toHaveBeenCalledTimes(1);
    const close = screen.getByRole("button", {
      name: "Fechar",
    }) as HTMLButtonElement;
    expect(close.disabled).toBe(true);
    fireEvent.click(close);
    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { bubbles: true, cancelable: true }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Carrinho/ }));
    expect(screen.getByRole("dialog", { name: "Crie sua conta" })).toBeTruthy();
    await act(async () => creation.resolve(registered));
    await screen.findByRole("dialog", { name: "Entre na sua jornada" });
    expect(
      (screen.getByRole("button", { name: "Fechar" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
  it("abandons a pending registration result if another session is restored", async () => {
    const creation = deferred<typeof registered>();
    vi.mocked(registration.registerCustomer).mockReturnValue(creation.promise);
    renderShop();
    await openRegistration();
    fireEvent.submit(screen.getByLabelText("Senha").closest("form")!);
    const signal = vi.mocked(registration.registerCustomer).mock.calls[0][1]!;
    act(() => notify(user));
    await screen.findByRole("dialog", { name: "Minha conta" });
    expect(signal.aborted).toBe(true);
    await act(async () => creation.resolve(registered));
    expect(screen.getByRole("dialog", { name: "Minha conta" })).toBeTruthy();
    expect(screen.queryByText(/Conta criada!/)).toBeNull();
    expect(session.login).not.toHaveBeenCalled();
  });
  it("discards passwords when switching between login and registration", async () => {
    renderShop();
    await openRegistration();
    fireEvent.click(screen.getByRole("button", { name: "Já tenho conta" }));
    expect((screen.getByLabelText("E-mail") as HTMLInputElement).value).toBe(
      "new@example.com",
    );
    expect((screen.getByLabelText("Senha") as HTMLInputElement).value).toBe("");
    fireEvent.change(screen.getByLabelText("Senha"), {
      target: { value: "old login password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Criar conta" }));
    expect((screen.getByLabelText("Senha") as HTMLInputElement).value).toBe("");
    expect(
      (screen.getByLabelText("Confirmar senha") as HTMLInputElement).value,
    ).toBe("");
  });
  it("asks for login when adding while logged out and submits credentials", async () => {
    vi.mocked(session.login).mockImplementation(async () => {
      notify(user);
      return { accessToken: "a", user, expiresIn: 900 };
    });
    render(
      <ShopProvider>
        <AccountActions />
        <AddButton id="p" available />
      </ShopProvider>,
    );
    fireEvent.click(screen.getByText("+ carrinho"));
    expect(screen.getByText("Entre na sua jornada")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("E-mail"), {
      target: { value: "test@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Senha"), {
      target: { value: "password" },
    });
    fireEvent.submit(screen.getByLabelText("Senha").closest("form")!);
    await waitFor(() =>
      expect(session.login).toHaveBeenCalledWith(
        "test@example.com",
        "password",
      ),
    );
    await screen.findByText("Seu carrinho");
  });
  it("uses latest cart quantity when adding and allows removal", async () => {
    vi.mocked(session.refresh).mockImplementation(async () => {
      notify(user);
      return { accessToken: "a", user, expiresIn: 900 };
    });
    render(
      <ShopProvider>
        <AccountActions />
        <AddButton id="p" available />
      </ShopProvider>,
    );
    await screen.findByText("Test");
    fireEvent.click(screen.getByText("+ carrinho"));
    await waitFor(() =>
      expect(session.authorized).toHaveBeenCalledWith("/cart/items/p", {
        method: "PUT",
        body: JSON.stringify({ quantity: 3 }),
      }),
    );
    fireEvent.click(screen.getByText(/Carrinho/));
    await screen.findByText("Remover");
    fireEvent.click(screen.getByText("Remover"));
    await waitFor(() =>
      expect(session.authorized).toHaveBeenCalledWith("/cart/items/p", {
        method: "DELETE",
      }),
    );
  });
  it.each([null, { ...user, id: "other-user", name: "Other" }])(
    "does not mutate a different session after the cart read finishes: %s",
    async (nextUser) => {
      restoreSession();
      renderShop();
      await screen.findByText("Test");
      await waitFor(() => expect(session.authorized).toHaveBeenCalled());
      const fresh = deferred<typeof cart>();
      vi.mocked(session.authorized).mockImplementationOnce(() => fresh.promise);
      fireEvent.click(screen.getByText("+ carrinho"));
      await act(async () => {
        notify(nextUser);
        fresh.resolve(cart);
      });
      await waitFor(() => expect(screen.getByText("+ carrinho")).toBeTruthy());
      expect(
        vi
          .mocked(session.authorized)
          .mock.calls.filter(([, options]) => options?.method === "PUT"),
      ).toHaveLength(0);
      expect(screen.queryByText("Carta adicionada ao carrinho.")).toBeNull();
    },
  );
  it("blocks closing confirmation while the order is being created", async () => {
    restoreSession();
    const creation = deferred<Order>();
    const order: Order = {
      id: "a934bfb6-b071-4358-9849-593a04c67b6c",
      orderNumber: 18,
      status: "PENDING_PAYMENT",
      subtotal: "20.00",
      shippingAmount: "0.00",
      discountAmount: "0.00",
      total: "20.00",
      createdAt: "2026-10-22T20:00:00.000Z",
      updatedAt: "2026-10-22T20:00:00.000Z",
      paidAt: null,
      expiresAt: "2099-10-22T20:30:00.000Z",
      cancelledAt: null,
      items: [],
    };
    let submitted = false;
    vi.mocked(session.authorized).mockImplementation(async (path, options) => {
      if (path === "/orders" && options?.method === "POST") {
        submitted = true;
        return creation.promise;
      }
      if (path === "/cart")
        return submitted
          ? { items: [], summary: { totalQuantity: 0, subtotal: "0.00" } }
          : cart;
      if (path === `/orders/${order.id}`) return order;
      if (path === `/orders/${order.id}/payments/pix`)
        throw Object.assign(new Error("Pagamento Pix não encontrado."), {
          status: 404,
        });
      throw new Error(`Unexpected request: ${path}`);
    });
    renderShop();
    await screen.findByText("Test");
    fireEvent.click(screen.getByText(/Carrinho/));
    const continueButton = await screen.findByRole("button", {
      name: "Continuar compra",
    });
    await waitFor(() =>
      expect((continueButton as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(continueButton);
    fireEvent.click(screen.getByRole("button", { name: "Confirmar pedido" }));
    const close = screen.getByRole("button", { name: "Fechar" });
    expect((close as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(close);
    const dialog = screen.getByRole("dialog", { name: "Finalizar compra" });
    fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
    expect(screen.getByText("Finalizar compra")).toBeTruthy();
    expect(screen.getByText("Consultando pedido…")).toBeTruthy();
    await act(async () => creation.resolve(order));
    await screen.findByText("PEDIDO #18");
    await waitFor(() =>
      expect((close as HTMLButtonElement).disabled).toBe(false),
    );
    expect(
      vi
        .mocked(session.authorized)
        .mock.calls.filter(([, options]) => options?.method === "POST"),
    ).toHaveLength(1);
    fireEvent.click(close);
    expect(screen.queryByText("Finalizar compra")).toBeNull();
  });
});
