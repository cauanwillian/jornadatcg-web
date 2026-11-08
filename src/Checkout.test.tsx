// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Checkout, MyOrders } from "./Checkout";
import { authorized } from "./session";
import { loadAttempt } from "./purchase";
import type { Order, PixResult } from "./purchase";

vi.mock("./session", () => ({ authorized: vi.fn() }));

const key = "68a7b7af-18a9-46ab-b44d-a7438cbb5c02";
const orderId = "a934bfb6-b071-4358-9849-593a04c67b6c";
const deadline = "2099-10-22T20:30:00.000Z";
const order: Order = {
  id: orderId,
  orderNumber: 18,
  status: "PENDING_PAYMENT",
  subtotal: "10.00",
  shippingAmount: "0.00",
  discountAmount: "0.00",
  total: "10.00",
  createdAt: "2026-10-22T20:00:00.000Z",
  updatedAt: "2026-10-22T20:00:00.000Z",
  paidAt: null,
  expiresAt: deadline,
  cancelledAt: null,
  items: [
    {
      id: "order-item",
      productId: "product",
      cardName: "Pikachu",
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
const pix: PixResult = {
  payment: {
    id: "payment",
    orderId,
    shipmentId: null,
    provider: "asaas:sandbox",
    method: "PIX",
    status: "PENDING",
    amount: "10.00",
    installments: 1,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    paidAt: null,
    failedAt: null,
    expiresAt: deadline,
  },
  pix: {
    encodedImage: "aGVsbG8=",
    payload: "000201-pix-test-only",
    expirationDate: "2099-10-22 17:30:00",
  },
  reservationExpiresAt: deadline,
};
const notFound = () =>
  Object.assign(new Error("Pagamento Pix não encontrado."), { status: 404 });
const posts = () =>
  vi
    .mocked(authorized)
    .mock.calls.filter(([, options]) => options?.method === "POST");
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function view(initialOrder?: Order) {
  const onCreated = vi.fn();
  const onReviewCart = vi.fn();
  const props = {
    userId: "customer",
    subtotal: "10.00",
    canCheckout: true,
    initialOrder,
    onCreated,
    onReviewCart,
  };
  return { ...render(<Checkout {...props} />), props, onCreated, onReviewCart };
}

function pendingWithoutPix() {
  vi.mocked(authorized).mockImplementation(async (path, options) => {
    if (path === "/orders" && options?.method === "POST") return order;
    if (path === `/orders/${orderId}`) return order;
    if (path === `/orders/${orderId}/payments/pix`) throw notFound();
    throw new Error(`Unexpected request: ${path}`);
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  vi.spyOn(crypto, "randomUUID").mockReturnValue(key);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Checkout confirmation and recovery", () => {
  it("does not create an order on mount and persists its key before confirmation", async () => {
    pendingWithoutPix();
    vi.mocked(authorized).mockImplementationOnce(async (path, options) => {
      expect(path).toBe("/orders");
      expect(loadAttempt("customer")).toEqual({
        key,
        expectedSubtotal: "10.00",
      });
      expect(options).toEqual({
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: JSON.stringify({ expectedSubtotal: "10.00" }),
      });
      return order;
    });
    const { onCreated } = view();
    expect(authorized).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar pedido" }));
    await screen.findByText("PEDIDO #18");
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(posts()).toHaveLength(1);
    expect(loadAttempt("customer")).toBeNull();
    await screen.findByLabelText("CPF do pagador");
  });

  it("reuses the same request after network failure even when the subtotal changes", async () => {
    pendingWithoutPix();
    vi.mocked(authorized).mockRejectedValueOnce(
      new Error("Conexão interrompida."),
    );
    const { rerender, props, onCreated } = view();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar pedido" }));
    await screen.findByText("Conexão interrompida.");
    expect(onCreated).not.toHaveBeenCalled();
    expect(loadAttempt("customer")).toEqual({ key, expectedSubtotal: "10.00" });
    rerender(<Checkout {...props} subtotal="99.00" canCheckout={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Recuperar pedido" }));
    await screen.findByText("PEDIDO #18");
    expect(posts()).toHaveLength(2);
    expect(posts()[1]).toEqual(posts()[0]);
    expect(onCreated).toHaveBeenCalledTimes(1);
    await screen.findByLabelText("CPF do pagador");
  });

  it("requires cart review after a definitive price conflict and does not retry", async () => {
    const conflict = Object.assign(new Error("O valor do carrinho mudou."), {
      status: 409,
    });
    vi.mocked(authorized).mockRejectedValue(conflict);
    const { onReviewCart, onCreated } = view();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar pedido" }));
    await screen.findByRole("alert");
    const confirm = screen.getByRole("button", {
      name: "Confirmar pedido",
    }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(posts()).toHaveLength(1);
    expect(onCreated).not.toHaveBeenCalled();
    expect(loadAttempt("customer")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Revisar carrinho" }));
    expect(onReviewCart).toHaveBeenCalledTimes(1);
  });

  it("retains the original request on an idempotency conflict", async () => {
    vi.mocked(authorized).mockRejectedValue(
      Object.assign(
        new Error("Idempotency-Key já utilizada com outro valor."),
        { status: 409 },
      ),
    );
    view();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar pedido" }));
    await screen.findByRole("alert");
    expect(loadAttempt("customer")).toEqual({ key, expectedSubtotal: "10.00" });
    expect(posts()).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Recuperar pedido" }),
    ).toBeTruthy();
  });
});

describe("Pix payment", () => {
  it("creates Pix only after CPF submission and displays the returned QR and copy code", async () => {
    let issued = false;
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.mocked(authorized).mockImplementation(async (path, options) => {
      if (path === `/orders/${orderId}`) return order;
      if (path === `/orders/${orderId}/payments/pix`) {
        if (options?.method === "POST") {
          issued = true;
          return pix;
        }
        if (issued) return pix;
        throw notFound();
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    view(order);
    const cpf = await screen.findByLabelText("CPF do pagador");
    expect(posts()).toHaveLength(0);
    fireEvent.change(cpf, { target: { value: "52998224725" } });
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Gerar Pix" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    fireEvent.submit(cpf.closest("form")!);
    const image = await screen.findByRole("img", {
      name: "QR Code Pix do pedido 18",
    });
    expect(image.getAttribute("src")).toBe("data:image/png;base64,aGVsbG8=");
    expect(
      (screen.getByLabelText("Código Pix copia e cola") as HTMLTextAreaElement)
        .value,
    ).toBe(pix.pix!.payload);
    expect(
      screen.getByText("Ambiente de testes: este Pix é do sandbox Asaas."),
    ).toBeTruthy();
    expect(posts()).toEqual([
      [
        `/orders/${orderId}/payments/pix`,
        {
          method: "POST",
          body: JSON.stringify({ cpf: "52998224725" }),
        },
      ],
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Copiar código Pix" }));
    await screen.findByText("Código Pix copiado.");
    expect(writeText).toHaveBeenCalledWith(pix.pix!.payload);
    expect(posts()).toHaveLength(1);
  });

  it("confirms only after paid Pix is reconciled and the authoritative order is read again", async () => {
    let reads = 0;
    const paidOrder: Order = {
      ...order,
      status: "PAID",
      paidAt: order.createdAt,
    };
    vi.mocked(authorized).mockImplementation(async (path) => {
      if (path === `/orders/${orderId}`)
        return ++reads === 1 ? order : paidOrder;
      if (path === `/orders/${orderId}/payments/pix`)
        return {
          ...pix,
          payment: { ...pix.payment, status: "PAID", paidAt: order.createdAt },
          pix: null,
        };
      throw new Error(`Unexpected request: ${path}`);
    });
    view(order);
    await screen.findByText(
      "Pagamento confirmado. Suas cartas ficam disponíveis para acumular com novas compras.",
    );
    expect(reads).toBe(2);
    expect(screen.getByText("Pagamento confirmado")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
    expect(posts()).toHaveLength(0);
  });

  it("hides an expired QR and generation without declaring the order paid by the clock", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-22T20:00:00.000Z"));
    const expiresAt = "2026-10-22T20:00:02.000Z";
    vi.mocked(authorized).mockImplementation(async (path) => {
      if (path === `/orders/${orderId}`) return { ...order, expiresAt };
      return { ...pix, reservationExpiresAt: expiresAt };
    });
    view({ ...order, expiresAt });
    await act(async () => {});
    expect(
      screen.getByRole("img", { name: "QR Code Pix do pedido 18" }),
    ).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByRole("button", { name: "Gerar Pix" })).toBeNull();
    expect(
      screen.getByText(
        "O prazo exibido terminou. Atualize o pagamento para conferir a situação do pedido.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Pagamento confirmado")).toBeNull();
    expect(screen.getByText("Aguardando pagamento")).toBeTruthy();
    expect(posts()).toHaveLength(0);
  });

  it("polls with GETs and never automatically issues a Pix POST", async () => {
    vi.useFakeTimers();
    pendingWithoutPix();
    view(order);
    await act(async () => {});
    const initialCalls = vi.mocked(authorized).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(vi.mocked(authorized).mock.calls.length).toBeGreaterThan(
      initialCalls,
    );
    expect(posts()).toHaveLength(0);
    expect(
      vi
        .mocked(authorized)
        .mock.calls.every(
          ([, options]) => !options?.method || options.method === "GET",
        ),
    ).toBe(true);
  });

  it("ignores double submission while Pix generation is in flight", async () => {
    const creation = deferred<PixResult>();
    let issued = false;
    vi.mocked(authorized).mockImplementation(async (path, options) => {
      if (path === `/orders/${orderId}`) return order;
      if (options?.method === "POST") {
        await creation.promise;
        issued = true;
        return pix;
      }
      if (issued) return pix;
      throw notFound();
    });
    view(order);
    const cpf = await screen.findByLabelText("CPF do pagador");
    fireEvent.change(cpf, { target: { value: "52998224725" } });
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Gerar Pix" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    fireEvent.submit(cpf.closest("form")!);
    fireEvent.submit(cpf.closest("form")!);
    expect(posts()).toHaveLength(1);
    expect(
      (
        screen.getByRole("button", {
          name: "Gerando Pix…",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await act(async () => {
      creation.resolve(pix);
    });
    await screen.findByRole("img", { name: "QR Code Pix do pedido 18" });
    expect(posts()).toHaveLength(1);
  });
});

describe("My orders", () => {
  it("lists existing orders with GET only and opens the selected order", async () => {
    const other: Order = {
      ...order,
      id: "0c754b6a-b508-4bc9-91de-7bfa3e9f9477",
      orderNumber: 19,
      status: "PAID",
    };
    vi.mocked(authorized).mockResolvedValue({
      items: [order, other],
      page: 1,
      pageSize: 20,
      total: 2,
    });
    const onOpen = vi.fn();
    render(<MyOrders onOpen={onOpen} />);
    await screen.findByText("Pedido #18");
    expect(authorized).toHaveBeenCalledWith(
      "/orders?page=1&pageSize=20",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    fireEvent.click(screen.getByText("Pedido #19"));
    expect(onOpen).toHaveBeenCalledWith(other);
    expect(posts()).toHaveLength(0);
    expect(authorized).toHaveBeenCalledTimes(1);
  });
});
