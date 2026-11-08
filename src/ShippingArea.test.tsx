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
import { Shipping } from "./ShippingArea";
import { authorized } from "./session";
import { ensureShipmentAttempt, loadShipmentAttempt } from "./shipping";
import type {
  AvailableItem,
  AvailablePage,
  QuoteBatch,
  Shipment,
  ShipmentInput,
} from "./shipping";
import type { PixResult } from "./purchase";

vi.mock("./session", () => ({ authorized: vi.fn() }));
const paymentView = vi.hoisted(() => ({ real: false }));
vi.mock("./ShippingAddresses", () => ({
  AddressPicker: ({
    value,
    onChange,
    disabled,
  }: {
    value: string;
    onChange: (value: string) => void;
    disabled: boolean;
  }) => (
    <label>
      Endereço de entrega
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Selecione</option>
        <option value="e01b7f30-c1aa-4038-810b-0501fb301ad4">
          Casa de teste
        </option>
      </select>
    </label>
  ),
}));
vi.mock("./FreightPayment", async () => {
  const actual =
    await vi.importActual<typeof import("./FreightPayment")>(
      "./FreightPayment",
    );
  return {
    FreightPayment: (props: Parameters<typeof actual.FreightPayment>[0]) =>
      paymentView.real ? (
        <actual.FreightPayment {...props} />
      ) : (
        <div>
          <button onClick={() => props.onResolved(null)}>
            Confirmar ausência de cobrança
          </button>
          <button onClick={() => props.onResolved(paidPix())}>
            Confirmar cobrança paga
          </button>
        </div>
      ),
  };
});

const key = "68a7b7af-18a9-46ab-b44d-a7438cbb5c02";
const addressId = "e01b7f30-c1aa-4038-810b-0501fb301ad4";
const itemA = "a01b7f30-c1aa-4038-810b-0501fb301ad4";
const itemB = "b01b7f30-c1aa-4038-810b-0501fb301ad4";
const itemC = "c01b7f30-c1aa-4038-810b-0501fb301ad4";
const quoteId = "d01b7f30-c1aa-4038-810b-0501fb301ad4";
const deadline = "2099-10-22T20:30:00.000Z";
const createdAt = "2026-10-22T20:00:00.000Z";
const notFound = () =>
  Object.assign(new Error("Envio não encontrado."), { status: 404 });

function availableItem(
  orderItemId: string,
  name: string,
  orderNumber: number,
  availableQuantity = 70,
): AvailableItem {
  return {
    orderItemId,
    orderId:
      orderNumber === 11
        ? "f01b7f30-c1aa-4038-810b-0501fb301ad4"
        : "f02b7f30-c1aa-4038-810b-0501fb301ad4",
    orderNumber,
    paidAt: createdAt,
    productId: null,
    cardName: name,
    cardNumber: "025",
    setName: "Coleção de teste",
    conditionName: "Near Mint",
    languageName: "Português",
    categoryName: "Cartas avulsas",
    purchasedQuantity: availableQuantity,
    allocatedQuantity: 0,
    availableQuantity,
    unitPrice: "10.00",
    availableSubtotal: `${availableQuantity * 10}.00`,
  };
}

function shipment(): Shipment {
  return {
    id: key,
    status: "PENDING",
    shippingMethod: "TO_BE_DEFINED",
    shippingCost: null,
    address: {
      addressId,
      recipientName: "Destinatário de teste",
      zipCode: "78000000",
      street: "Rua de teste",
      number: "1",
      complement: null,
      neighborhood: "Centro",
      city: "Cuiabá",
      state: "MT",
    },
    trackingCode: null,
    selectedQuoteId: null,
    shippingPaidAt: null,
    packedAt: null,
    shippedAt: null,
    deliveredAt: null,
    quote: null,
    createdAt,
    updatedAt: createdAt,
    items: [
      {
        orderItemId: itemA,
        orderId: "f01b7f30-c1aa-4038-810b-0501fb301ad4",
        quantity: 1,
        cardName: "Pikachu",
        cardNumber: "025",
        setName: "Coleção de teste",
        conditionName: "Near Mint",
        languageName: "Português",
        unitPrice: "10.00",
        subtotal: "10.00",
      },
    ],
  };
}

function quotes(expiresAt = deadline): QuoteBatch {
  return {
    shipmentId: key,
    package: {
      name: "Pequena",
      height: 3,
      width: 12,
      length: 17,
      weight: 0.15,
    },
    expiresAt,
    options: [
      {
        id: quoteId,
        provider: "melhorenvio:sandbox",
        serviceCode: "2",
        serviceName: "SEDEX",
        carrier: "Correios",
        amount: "12.68",
        deliveryDays: 2,
        expiresAt,
      },
    ],
    providers: [
      { provider: "melhorenvio", status: "OK" },
      { provider: "superfrete", status: "NOT_CONFIGURED" },
    ],
  };
}

function paidPix(): PixResult {
  return {
    payment: {
      id: quoteId,
      orderId: null,
      shipmentId: key,
      provider: "asaas:sandbox",
      method: "PIX",
      status: "PAID",
      amount: "12.68",
      installments: 1,
      createdAt,
      updatedAt: createdAt,
      paidAt: createdAt,
      failedAt: null,
      expiresAt: deadline,
    },
    pix: null,
    reservationExpiresAt: deadline,
  };
}

function backend() {
  const state = {
    current: shipment(),
    exists: true,
    items: {
      1: [
        availableItem(itemA, "Pikachu", 11),
        availableItem(itemB, "Eevee", 12),
        availableItem(itemC, "Mew", 12),
      ],
    } as Record<number, AvailableItem[]>,
    total: 3,
    batch: quotes(),
    createError: null as Error | null,
    createLost: false,
    onCreate: (_input: ShipmentInput, _options: RequestInit) => {},
  };
  vi.mocked(authorized).mockImplementation(async (path, options) => {
    if (path.startsWith("/shipments/available-items?")) {
      const page = Number(new URLSearchParams(path.split("?")[1]).get("page"));
      return {
        items: state.items[page] ?? [],
        page,
        pageSize: 20,
        total: state.total,
        summary: { availableQuantity: 140, availableValue: "1400.00" },
      } satisfies AvailablePage;
    }
    if (path.startsWith("/shipments?"))
      return { items: [state.current], page: 1, pageSize: 20, total: 1 };
    if (path === "/shipments" && options?.method === "POST") {
      const input = JSON.parse(String(options.body)) as ShipmentInput;
      state.onCreate(input, options);
      if (state.createError) throw state.createError;
      state.current = {
        ...state.current,
        address: { ...state.current.address, addressId: input.addressId },
        items: input.items.map(({ orderItemId, quantity }) => {
          const item = Object.values(state.items)
            .flat()
            .find((item) => item.orderItemId === orderItemId)!;
          return {
            orderItemId,
            orderId: item.orderId,
            quantity,
            cardName: item.cardName,
            cardNumber: item.cardNumber,
            setName: item.setName,
            conditionName: item.conditionName,
            languageName: item.languageName,
            unitPrice: item.unitPrice,
            subtotal: (Number(item.unitPrice) * quantity).toFixed(2),
          };
        }),
      };
      state.exists = true;
      if (state.createLost) throw new TypeError("Conexão interrompida.");
      return state.current;
    }
    if (path === `/shipments/${key}` && !options?.method) {
      if (!state.exists) throw notFound();
      return state.current;
    }
    if (path === `/shipments/${key}/payments/pix` && !options?.method)
      throw notFound();
    if (path === `/shipments/${key}/quotes` && options?.method === "POST") {
      state.current = {
        ...state.current,
        selectedQuoteId: null,
        quote: null,
        shippingCost: null,
        shippingMethod: "TO_BE_DEFINED",
      };
      return state.batch;
    }
    if (
      path === `/shipments/${key}/quotes/${quoteId}/select` &&
      options?.method === "POST"
    ) {
      const option = state.batch.options[0];
      state.current = {
        ...state.current,
        selectedQuoteId: quoteId,
        shippingMethod: option.serviceCode,
        shippingCost: option.amount,
        quote: {
          ...option,
          package: {
            ...state.batch.package,
            originZipCode: "78556858",
            destinationZipCode: "78000000",
            declaredValue: "10.00",
          },
        },
      };
      return {
        shipmentId: key,
        quoteId,
        ...option,
        shippingCost: option.amount,
      };
    }
    if (path === `/shipments/${key}/cancel` && options?.method === "POST") {
      state.current = { ...state.current, status: "CANCELLED" };
      return state.current;
    }
    throw new Error(`Unexpected request: ${options?.method ?? "GET"} ${path}`);
  });
  return state;
}

function view(initialShipmentId?: string, isCurrentSession = () => true) {
  return render(
    <Shipping
      userId="customer"
      initialShipmentId={initialShipmentId}
      isCurrentSession={isCurrentSession}
      onBusyChange={vi.fn()}
    />,
  );
}
function posts() {
  return vi
    .mocked(authorized)
    .mock.calls.filter(([, options]) => options?.method === "POST");
}
async function openShipment(rowName: RegExp = /Aguardando frete/) {
  fireEvent.click(screen.getByRole("button", { name: "Meus envios" }));
  fireEvent.click(await screen.findByRole("button", { name: rowName }));
  await screen.findByRole("button", { name: "Confirmar ausência de cobrança" });
}
async function selectCards() {
  fireEvent.click(await screen.findByRole("checkbox", { name: /Pikachu/ }));
  fireEvent.change(
    screen.getByRole("spinbutton", { name: "Quantidade de Pikachu" }),
    { target: { value: "2" } },
  );
  fireEvent.change(
    screen.getByRole("combobox", { name: "Endereço de entrega" }),
    { target: { value: addressId } },
  );
}

beforeEach(() => {
  paymentView.real = false;
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

describe("Accumulated purchases and shipping requests", () => {
  it("opens a notification shipment by ID and only reads its existing payment", async () => {
    backend();
    paymentView.real = true;
    view(key);

    await screen.findByText("Destinatário de teste");
    await waitFor(() =>
      expect(authorized).toHaveBeenCalledWith(
        `/shipments/${key}/payments/pix`,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
    expect(authorized).toHaveBeenCalledWith(
      `/shipments/${key}`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(
      vi
        .mocked(authorized)
        .mock.calls.some(
          ([path]) =>
            path.startsWith("/shipments/available-items?") ||
            path.startsWith("/shipments?"),
        ),
    ).toBe(false);
    expect(posts()).toHaveLength(0);
    expect(crypto.randomUUID).not.toHaveBeenCalled();
  });

  it("preserves a saved creation attempt while opening a notification and returning to purchases", async () => {
    backend();
    const saved = ensureShipmentAttempt("customer", {
      addressId,
      items: [{ orderItemId: itemA, quantity: 2 }],
    });
    const remove = vi.spyOn(Storage.prototype, "removeItem");
    const write = vi.spyOn(Storage.prototype, "setItem");
    view(key);

    await screen.findByText("Destinatário de teste");
    expect(loadShipmentAttempt("customer")).toEqual(saved);
    fireEvent.click(screen.getByRole("button", { name: "Compras acumuladas" }));
    await screen.findByRole("button", { name: "Recuperar solicitação" });
    expect(loadShipmentAttempt("customer")).toEqual(saved);
    expect(remove).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
    expect(posts()).toHaveLength(0);
  });

  it("offers a safe retry after a linked shipment cannot be read", async () => {
    const state = backend();
    state.exists = false;
    view(key);

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Envio não encontrado ou indisponível para esta conta.",
    );
    expect(screen.queryByText("Destinatário de teste")).toBeNull();
    state.exists = true;
    fireEvent.click(screen.getByRole("button", { name: "Atualizar envio" }));
    await screen.findByText("Destinatário de teste");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(posts()).toHaveLength(0);
    expect(crypto.randomUUID).not.toHaveBeenCalled();
  });

  it("times out an abort-ignoring detail read and retries with a new controller", async () => {
    backend();
    vi.useFakeTimers();
    let resolveFirst!: (value: Shipment) => void;
    vi.mocked(authorized).mockImplementationOnce(
      () =>
        new Promise<Shipment>((done) => {
          resolveFirst = done;
        }),
    );
    const rendered = view(key);
    const firstSignal = vi.mocked(authorized).mock.calls[0][1]!.signal!;
    expect(screen.getByText("Carregando envio…")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_001);
    });
    expect(firstSignal.aborted).toBe(true);
    expect(screen.getByRole("alert").textContent).toBe(
      "Não foi possível consultar o envio. Atualize e tente novamente.",
    );
    expect(screen.queryByText("Carregando envio…")).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Atualizar envio" }));
    });
    expect(screen.getByText("Destinatário de teste")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    const retrySignal = vi.mocked(authorized).mock.calls[1][1]!.signal!;
    expect(retrySignal).not.toBe(firstSignal);
    expect(retrySignal.aborted).toBe(false);

    await act(async () => {
      resolveFirst({
        ...shipment(),
        address: { ...shipment().address, recipientName: "Resposta antiga" },
      });
    });
    expect(screen.queryByText("Resposta antiga")).toBeNull();
    expect(screen.getByText("Destinatário de teste")).toBeTruthy();
    expect(posts()).toHaveLength(0);
    rendered.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the detail deadline and clock when unmounted during an unanswered read", async () => {
    vi.useFakeTimers();
    vi.mocked(authorized).mockReturnValue(new Promise(() => {}));
    const rendered = view(key);
    const signal = vi.mocked(authorized).mock.calls[0][1]!.signal!;
    expect(vi.getTimerCount()).toBe(2);
    await act(async () => {
      rendered.unmount();
    });
    expect(signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(posts()).toHaveLength(0);
  });

  it("can leave a failed linked shipment and read the customer's requests", async () => {
    const state = backend();
    state.exists = false;
    view(key);

    await screen.findByRole("alert");
    fireEvent.click(
      screen.getByRole("button", { name: "Voltar para meus envios" }),
    );
    await screen.findByRole("button", { name: /Aguardando frete/ });
    expect(authorized).toHaveBeenCalledWith(
      "/shipments?page=1&pageSize=20",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(posts()).toHaveLength(0);
  });

  it("does not display raw failures or mount a payment from an invalid shipment response", async () => {
    backend();
    vi.mocked(authorized).mockResolvedValueOnce({
      ...shipment(),
      id: "different-shipment",
    });
    paymentView.real = true;
    view(key);

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Não foi possível consultar o envio. Atualize e tente novamente.",
    );
    expect(screen.queryByText("Destinatário de teste")).toBeNull();
    expect(authorized).toHaveBeenCalledTimes(1);
    expect(posts()).toHaveLength(0);
  });

  it("ignores a late linked shipment response from an earlier session", async () => {
    let resolve!: (value: Shipment) => void;
    vi.mocked(authorized).mockImplementationOnce(
      () =>
        new Promise<Shipment>((done) => {
          resolve = done;
        }),
    );
    paymentView.real = true;
    let currentSession = true;
    view(key, () => currentSession);
    await waitFor(() => expect(authorized).toHaveBeenCalledTimes(1));
    currentSession = false;
    await act(async () => {
      resolve(shipment());
    });

    expect(screen.queryByText("Destinatário de teste")).toBeNull();
    expect(authorized).toHaveBeenCalledTimes(1);
    expect(posts()).toHaveLength(0);
  });

  it("aborts a linked shipment read on unmount and ignores its late completion", async () => {
    let resolve!: (value: Shipment) => void;
    vi.mocked(authorized).mockImplementationOnce(
      () =>
        new Promise<Shipment>((done) => {
          resolve = done;
        }),
    );
    paymentView.real = true;
    const rendered = view(key);
    await waitFor(() => expect(authorized).toHaveBeenCalledTimes(1));
    const signal = vi.mocked(authorized).mock.calls[0][1]?.signal;
    rendered.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      resolve(shipment());
    });

    expect(authorized).toHaveBeenCalledTimes(1);
    expect(posts()).toHaveLength(0);
  });

  it("only reads available purchases on mount and requests when the customer opens their list", async () => {
    backend();
    view();
    await screen.findByRole("checkbox", { name: /Pikachu/ });
    expect(posts()).toHaveLength(0);
    expect(authorized).toHaveBeenCalledWith(
      "/shipments/available-items?page=1&pageSize=20",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Meus envios" }));
    await screen.findByRole("button", { name: /Aguardando frete/ });
    expect(authorized).toHaveBeenCalledWith(
      "/shipments?page=1&pageSize=20",
      expect.anything(),
    );
    expect(posts()).toHaveLength(0);
  });

  it("limits the total to 70 across different orders and persists the exact body before creation", async () => {
    const state = backend();
    state.exists = false;
    state.onCreate = (input, options) => {
      const expected = {
        addressId,
        items: [
          { orderItemId: itemA, quantity: 40 },
          { orderItemId: itemB, quantity: 30 },
        ],
      };
      expect(loadShipmentAttempt("customer")).toEqual({ key, input: expected });
      expect(input).toEqual(expected);
      expect(new Headers(options.headers).get("Idempotency-Key")).toBe(key);
    };
    view();
    fireEvent.click(await screen.findByRole("checkbox", { name: /Pikachu/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Eevee/ }));
    const pikachu = screen.getByRole("spinbutton", {
      name: "Quantidade de Pikachu",
    }) as HTMLInputElement;
    const eevee = screen.getByRole("spinbutton", {
      name: "Quantidade de Eevee",
    }) as HTMLInputElement;
    fireEvent.change(pikachu, { target: { value: "40" } });
    fireEvent.change(eevee, { target: { value: "30" } });
    expect(screen.getByText("70 de 70 cartas selecionadas")).toBeTruthy();
    fireEvent.change(pikachu, { target: { value: "41" } });
    expect(pikachu.value).toBe("40");
    expect(
      (screen.getByRole("checkbox", { name: /Mew/ }) as HTMLInputElement)
        .disabled,
    ).toBe(true);
    fireEvent.change(
      screen.getByRole("combobox", { name: "Endereço de entrega" }),
      { target: { value: addressId } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Solicitar envio" }));
    await screen.findByText("Destinatário de teste");
    expect(posts().map(([path]) => path)).toEqual(["/shipments"]);
    const calls = vi.mocked(authorized).mock.calls;
    expect(
      calls.findIndex(([path]) => path === `/shipments/${key}`),
    ).toBeLessThan(
      calls.findIndex(
        ([path, options]) =>
          path === "/shipments" && options?.method === "POST",
      ),
    );
    expect(loadShipmentAttempt("customer")).toBeNull();
  });

  it("keeps selected quantities while moving between purchase pages", async () => {
    const state = backend();
    state.total = 21;
    state.items = {
      1: [availableItem(itemA, "Pikachu", 11)],
      2: [availableItem(itemB, "Eevee", 12)],
    };
    view();
    fireEvent.click(await screen.findByRole("checkbox", { name: /Pikachu/ }));
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Quantidade de Pikachu" }),
      { target: { value: "3" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /Eevee/ }));
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Quantidade de Eevee" }),
      { target: { value: "2" } },
    );
    expect(screen.getByText("5 de 70 cartas selecionadas")).toBeTruthy();
    expect(screen.getByText("3× Pikachu (pedido #11)")).toBeTruthy();
    expect(screen.getByText("2× Eevee (pedido #12)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Anterior" }));
    expect(
      (
        (await screen.findByRole("spinbutton", {
          name: "Quantidade de Pikachu",
        })) as HTMLInputElement
      ).value,
    ).toBe("3");
    expect(posts()).toHaveLength(0);
  });

  it("recovers an accepted request after a lost response by reading the known UUID instead of posting again", async () => {
    const state = backend();
    state.exists = false;
    state.createLost = true;
    view();
    await selectCards();
    fireEvent.click(screen.getByRole("button", { name: "Solicitar envio" }));
    await screen.findByRole("alert");
    const original = loadShipmentAttempt("customer");
    expect(original).toEqual({
      key,
      input: { addressId, items: [{ orderItemId: itemA, quantity: 2 }] },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Recuperar solicitação" }),
    );
    await screen.findByText("Destinatário de teste");
    expect(posts()).toHaveLength(1);
    expect(loadShipmentAttempt("customer")).toBeNull();
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
  });

  it("keeps the original UUID and body after a conflict requiring the same Idempotency-Key", async () => {
    const state = backend();
    state.exists = false;
    state.createError = Object.assign(
      new Error(
        "Dados alterados. Tente novamente com a mesma Idempotency-Key.",
      ),
      { status: 409 },
    );
    view();
    await selectCards();
    fireEvent.click(screen.getByRole("button", { name: "Solicitar envio" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Idempotency-Key",
    );
    expect(loadShipmentAttempt("customer")).toEqual({
      key,
      input: { addressId, items: [{ orderItemId: itemA, quantity: 2 }] },
    });
    expect(
      screen.getByRole("button", { name: "Recuperar solicitação" }),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("combobox", {
          name: "Endereço de entrega",
        }) as HTMLSelectElement
      ).disabled,
    ).toBe(true);
    expect(posts()).toHaveLength(1);
  });

  it("opens an existing shipment through GET without automatically recalculating freight", async () => {
    backend();
    view();
    await openShipment();
    expect(screen.getByText("Destinatário de teste")).toBeTruthy();
    expect(authorized).toHaveBeenCalledWith(
      `/shipments/${key}`,
      expect.anything(),
    );
    expect(posts()).toHaveLength(0);
  });

  it("does not quote until the absence of an existing payment is known", async () => {
    backend();
    view();
    await openShipment();
    const calculate = screen.getByRole("button", {
      name: "Calcular frete",
    }) as HTMLButtonElement;
    expect(calculate.disabled).toBe(true);
    fireEvent.click(calculate);
    expect(posts()).toHaveLength(0);
    fireEvent.click(
      screen.getByRole("button", { name: "Confirmar ausência de cobrança" }),
    );
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Calcular frete",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
  });

  it("quotes and selects only on explicit actions, then reloads the authoritative selected cost", async () => {
    backend();
    view();
    await openShipment();
    fireEvent.click(
      screen.getByRole("button", { name: "Confirmar ausência de cobrança" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Calcular frete" }));
    await screen.findByRole("button", { name: "Escolher" });
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Escolher" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    expect(posts().map(([path]) => path)).toEqual([`/shipments/${key}/quotes`]);
    fireEvent.click(screen.getByRole("button", { name: "Escolher" }));
    await screen.findByRole("button", { name: "Selecionado" });
    expect(posts().map(([path]) => path)).toEqual([
      `/shipments/${key}/quotes`,
      `/shipments/${key}/quotes/${quoteId}/select`,
    ]);
    expect(
      screen.getByText(/Correios · SEDEX · prazo estimado de 2 dias/),
    ).toBeTruthy();
    const calls = vi.mocked(authorized).mock.calls;
    const selectIndex = calls.findIndex(([path]) => path.endsWith("/select"));
    expect(
      calls
        .slice(selectIndex + 1)
        .some(
          ([path, options]) => path === `/shipments/${key}` && !options?.method,
        ),
    ).toBe(true);
    expect(screen.getAllByText(/12,68/).length).toBeGreaterThan(0);
  });

  it("blocks selecting an expired quote without sending a selection request", async () => {
    const state = backend();
    state.batch = quotes("2000-01-01T00:00:00.000Z");
    view();
    await openShipment();
    fireEvent.click(
      screen.getByRole("button", { name: "Confirmar ausência de cobrança" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Calcular frete" }));
    const choose = (await screen.findByRole("button", {
      name: "Escolher",
    })) as HTMLButtonElement;
    expect(choose.disabled).toBe(true);
    fireEvent.click(choose);
    expect(
      screen.getByText("Cotação expirada. Calcule o frete novamente."),
    ).toBeTruthy();
    expect(posts().map(([path]) => path)).toEqual([`/shipments/${key}/quotes`]);
  });

  it("freezes quoting and cancellation after payment is confirmed and reloads the shipment", async () => {
    const state = backend();
    view();
    await openShipment();
    state.current = {
      ...state.current,
      status: "PREPARING",
      shippingPaidAt: createdAt,
      shippingCost: "12.68",
    };
    fireEvent.click(
      screen.getByRole("button", { name: "Confirmar cobrança paga" }),
    );
    await screen.findByText("Preparando envio");
    expect(
      screen.queryByRole("button", { name: /Calcular frete|Recalcular frete/ }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Cancelar solicitação" }),
    ).toBeNull();
    expect(posts()).toHaveLength(0);
  });

  it("removes previously quoted options when refreshing discovers a freight payment from another tab", async () => {
    const state = backend();
    view();
    await openShipment();
    fireEvent.click(
      screen.getByRole("button", { name: "Confirmar ausência de cobrança" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Calcular frete" }));
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Escolher" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    expect(posts().map(([path]) => path)).toEqual([`/shipments/${key}/quotes`]);

    // The existing payment component still knows only its earlier null result.
    // The independent shipment GET must immediately override that stale state.
    state.current = {
      ...state.current,
      status: "PREPARING",
      shippingPaidAt: createdAt,
      shippingCost: "12.68",
    };
    fireEvent.click(screen.getByRole("button", { name: "Atualizar envio" }));
    await screen.findByText("Preparando envio");

    expect(screen.queryByRole("button", { name: "Escolher" })).toBeNull();
    expect(screen.queryByText("Escolha uma opção de frete")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Calcular frete|Recalcular frete/ }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Cancelar solicitação" }),
    ).toBeNull();
    expect(posts().map(([path]) => path)).toEqual([`/shipments/${key}/quotes`]);
  });

  it("requires known absence of payment and a second confirmation to cancel", async () => {
    backend();
    view();
    await openShipment();
    expect(
      screen.queryByRole("button", { name: "Cancelar solicitação" }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Confirmar ausência de cobrança" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Cancelar solicitação" }),
    );
    expect(posts()).toHaveLength(0);
    expect(
      screen.getByText(/Cancelar esta solicitação libera as cartas/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Manter solicitação" }));
    expect(posts()).toHaveLength(0);
    fireEvent.click(
      screen.getByRole("button", { name: "Cancelar solicitação" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Confirmar cancelamento" }),
    );
    await screen.findByText("Cancelado");
    expect(posts().map(([path]) => path)).toEqual([`/shipments/${key}/cancel`]);
  });

  it("displays tracking and delivery only from server shipment fields", async () => {
    const state = backend();
    state.current = {
      ...state.current,
      status: "DELIVERED",
      shippingPaidAt: createdAt,
      shippingCost: "12.68",
      trackingCode: "TEST123456789BR",
      shippedAt: createdAt,
      deliveredAt: "2026-10-25T15:00:00.000Z",
    };
    view();
    await openShipment(/Entregue/);
    expect(screen.getByText("Entregue")).toBeTruthy();
    expect(screen.getByText("TEST123456789BR")).toBeTruthy();
    expect(screen.getByText(/Postado em/)).toBeTruthy();
    expect(screen.getByText(/Entregue em/)).toBeTruthy();
    expect(
      screen.queryByRole("button", {
        name: /Calcular frete|Cancelar solicitação/,
      }),
    ).toBeNull();
    expect(posts()).toHaveLength(0);
  });
});
