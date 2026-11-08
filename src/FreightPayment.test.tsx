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
import { FreightPayment } from "./FreightPayment";
import type { PixResult } from "./purchase";
import { authorized } from "./session";

vi.mock("./session", () => ({ authorized: vi.fn() }));

const shipmentId = "shipment-test";
const path = `/shipments/${shipmentId}/payments/pix`;
const deadline = "2099-10-22T21:00:00.000Z";
const pix: PixResult = {
  payment: {
    id: "freight-payment",
    orderId: null,
    shipmentId,
    provider: "asaas:sandbox",
    method: "PIX",
    status: "PENDING",
    amount: "12.68",
    installments: 1,
    createdAt: "2026-10-22T20:00:00.000Z",
    updatedAt: "2026-10-22T20:00:00.000Z",
    paidAt: null,
    failedAt: null,
    expiresAt: deadline,
  },
  pix: {
    encodedImage: "aGVsbG8=",
    payload: "000201-freight-test",
    expirationDate: "2099-10-22 18:00:00",
  },
  reservationExpiresAt: deadline,
};
const notFound = () =>
  Object.assign(new Error("Pagamento do frete não encontrado."), {
    status: 404,
  });
const unfinishedIntent = () =>
  Object.assign(
    new Error(
      "Criação do Pix ainda não concluída. Repita a solicitação para o mesmo pedido.",
    ),
    { status: 503 },
  );
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
function view(overrides: Partial<Parameters<typeof FreightPayment>[0]> = {}) {
  const props = {
    shipmentId,
    shippingCost: "12.68",
    shippingPaidAt: null,
    quoteExpiresAt: deadline,
    shipmentStatus: "PENDING",
    isCurrentSession: () => true,
    onBusyChange: vi.fn(),
    onResolved: vi.fn(),
    ...overrides,
  };
  return { ...render(<FreightPayment {...props} />), props };
}
async function fillCpf() {
  await waitFor(() =>
    expect(
      (screen.getByLabelText("CPF do pagador do frete") as HTMLInputElement)
        .disabled,
    ).toBe(false),
  );
  const input = screen.getByLabelText("CPF do pagador do frete");
  fireEvent.change(input, { target: { value: "529.982.247-25" } });
  return input.closest("form")!;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Freight Pix", () => {
  it("allows an explicit same-shipment POST to resume a known unissued intent", async () => {
    const creation = deferred<PixResult>();
    vi.mocked(authorized).mockImplementation(async (_path, options) => {
      if (options?.method === "POST") return creation.promise;
      throw unfinishedIntent();
    });
    const { props } = view();
    const form = await fillCpf();
    expect(
      screen.getByRole("button", { name: "Retomar Pix deste envio" }),
    ).toBeTruthy();
    expect(props.onResolved).not.toHaveBeenCalled();
    expect(posts()).toHaveLength(0);
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(posts()).toEqual([
      [path, { method: "POST", body: JSON.stringify({ cpf: "52998224725" }) }],
    ]);
    expect(props.onBusyChange).toHaveBeenCalledWith(true);
    await act(async () => {
      creation.resolve(pix);
    });
    expect(props.onResolved).toHaveBeenCalledWith(pix);
    expect(props.onBusyChange).toHaveBeenLastCalledWith(false);
    expect(posts()).toHaveLength(1);
  });

  it("requires a manual check before resuming an unfinished intent after failed POST", async () => {
    vi.useFakeTimers();
    let postCount = 0;
    vi.mocked(authorized).mockImplementation(async (_path, options) => {
      if (options?.method === "POST") {
        postCount++;
        if (postCount === 1) throw new Error("Conexão interrompida.");
        return pix;
      }
      if (postCount > 0) throw unfinishedIntent();
      throw notFound();
    });
    const { props } = view();
    await act(async () => {});
    const input = screen.getByLabelText("CPF do pagador do frete");
    fireEvent.change(input, { target: { value: "52998224725" } });
    fireEvent.submit(input.closest("form")!);
    await act(async () => {});
    expect(posts()).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(screen.getByText(/Conexão interrompida/)).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Retomar Pix deste envio",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.submit(input.closest("form")!);
    expect(posts()).toHaveLength(1);
    fireEvent.click(
      screen.getByRole("button", { name: "Atualizar pagamento do frete" }),
    );
    await act(async () => {});
    expect(screen.queryByText(/Conexão interrompida/)).toBeNull();
    expect(
      (
        screen.getByRole("button", {
          name: "Retomar Pix deste envio",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(props.onResolved).toHaveBeenCalledTimes(1);
    fireEvent.submit(input.closest("form")!);
    await act(async () => {});
    expect(posts()).toHaveLength(2);
    expect(posts().every(([endpoint]) => endpoint === path)).toBe(true);
    expect(props.onResolved).toHaveBeenLastCalledWith(pix);
  });

  it("does not allow POST when the provider may already have an unresolved charge", async () => {
    const ambiguous = Object.assign(
      new Error(
        "Cobrança ainda não localizada no Asaas. Não crie outro pedido; aguarde a reconciliação.",
      ),
      { status: 503 },
    );
    vi.mocked(authorized).mockRejectedValue(ambiguous);
    const { props } = view();
    await screen.findByText(/Cobrança ainda não localizada/);
    expect(
      (
        screen.getByRole("button", {
          name: "Gerar Pix do frete",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.submit(
      screen.getByLabelText("CPF do pagador do frete").closest("form")!,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Atualizar pagamento do frete" }),
    );
    await waitFor(() => expect(authorized).toHaveBeenCalledTimes(2));
    expect(props.onResolved).not.toHaveBeenCalled();
    expect(posts()).toHaveLength(0);
  });

  it("checks existing charges even without a quote, treats 404 as none and never posts automatically", async () => {
    vi.mocked(authorized).mockRejectedValue(notFound());
    const { props } = view({ shippingCost: null, quoteExpiresAt: null });
    await waitFor(() => expect(props.onResolved).toHaveBeenCalledWith(null));
    expect(authorized).toHaveBeenCalledWith(
      path,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(posts()).toHaveLength(0);
    expect(
      (
        screen.getByRole("button", {
          name: "Gerar Pix do frete",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("creates only after CPF submission, guards double submission, displays and copies the live Pix", async () => {
    const creation = deferred<PixResult>();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.mocked(authorized).mockImplementation(async (_path, options) => {
      if (options?.method === "POST") return creation.promise;
      throw notFound();
    });
    const { props } = view();
    const form = await fillCpf();
    expect(posts()).toHaveLength(0);
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(posts()).toEqual([
      [path, { method: "POST", body: JSON.stringify({ cpf: "52998224725" }) }],
    ]);
    expect(props.onBusyChange).toHaveBeenCalledWith(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Gerando Pix do frete…",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await act(async () => {
      creation.resolve(pix);
    });
    expect(
      screen
        .getByRole("img", { name: "QR Code Pix do frete" })
        .getAttribute("src"),
    ).toBe("data:image/png;base64,aGVsbG8=");
    expect(
      (
        screen.getByLabelText(
          "Código Pix do frete copia e cola",
        ) as HTMLTextAreaElement
      ).value,
    ).toBe(pix.pix!.payload);
    expect(
      screen.getByText("Ambiente de testes: este Pix é do sandbox Asaas."),
    ).toBeTruthy();
    expect(props.onResolved).toHaveBeenLastCalledWith(pix);
    expect(props.onBusyChange).toHaveBeenLastCalledWith(false);
    fireEvent.click(
      screen.getByRole("button", { name: "Copiar código Pix do frete" }),
    );
    await screen.findByText("Código Pix copiado.");
    expect(writeText).toHaveBeenCalledWith(pix.pix!.payload);
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
  });

  it.each([
    { shippingCost: "0.00", quoteExpiresAt: deadline },
    { shippingCost: null, quoteExpiresAt: deadline },
    { shippingCost: "12.68", quoteExpiresAt: "2000-01-01T00:00:00.000Z" },
    { shippingCost: "12.68", quoteExpiresAt: null },
    { shippingCost: "12.68", quoteExpiresAt: "not-a-date" },
  ])("does not generate for invalid quote/cost %j", async (override) => {
    vi.mocked(authorized).mockRejectedValue(notFound());
    const { props } = view(override);
    await waitFor(() => expect(props.onResolved).toHaveBeenCalledWith(null));
    const form = screen
      .getByLabelText("CPF do pagador do frete")
      .closest("form")!;
    fireEvent.submit(form);
    expect(posts()).toHaveLength(0);
    expect(
      (
        screen.getByRole("button", {
          name: "Gerar Pix do frete",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("uses an existing charge deadline after quote expiry and permits resuming an intent without QR", async () => {
    const intent = { ...pix, pix: null };
    vi.mocked(authorized).mockResolvedValue(intent);
    view({ quoteExpiresAt: "2000-01-01T00:00:00.000Z" });
    const form = await fillCpf();
    expect(screen.getByText(/A cobrança está em processamento/)).toBeTruthy();
    fireEvent.submit(form);
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0][0]).toBe(path);
  });

  it("keeps a previously issued QR available after the quote expires", async () => {
    vi.mocked(authorized).mockResolvedValue(pix);
    view({ quoteExpiresAt: "2000-01-01T00:00:00.000Z" });
    await screen.findByRole("img", { name: "QR Code Pix do frete" });
    expect(posts()).toHaveLength(0);
  });

  it("hides expired QR without inferring payment from the clock", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-22T20:00:00.000Z"));
    const expiresAt = "2026-10-22T20:00:02.000Z";
    vi.mocked(authorized).mockResolvedValue({
      ...pix,
      reservationExpiresAt: expiresAt,
    });
    const { props } = view();
    await act(async () => {});
    expect(screen.getByRole("img")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByText(/Frete pago confirmado/)).toBeNull();
    expect(screen.getByText(/O prazo exibido terminou/)).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Retomar Pix do frete",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(props.onResolved).toHaveBeenCalledTimes(1);
    expect(posts()).toHaveLength(0);
  });

  it("reports confirmed payment from the API and stops polling a terminal result", async () => {
    vi.useFakeTimers();
    const paid = {
      ...pix,
      payment: {
        ...pix.payment,
        status: "PAID" as const,
        paidAt: "2026-10-22T20:00:00.000Z",
      },
      pix: null,
    };
    vi.mocked(authorized).mockResolvedValue(paid);
    const { props } = view();
    await act(async () => {});
    expect(screen.getByText(/Frete pago confirmado/)).toBeTruthy();
    expect(props.onResolved).toHaveBeenCalledWith(paid);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(authorized).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("img")).toBeNull();
    expect(posts()).toHaveLength(0);
  });

  it("honors a paid shipment without offering another charge", async () => {
    vi.mocked(authorized).mockRejectedValue(notFound());
    const { props } = view({
      shippingPaidAt: "2026-10-22T20:00:00.000Z",
      shipmentStatus: "PREPARING",
    });
    expect(screen.getByText(/Frete pago confirmado/)).toBeTruthy();
    await waitFor(() => expect(props.onResolved).toHaveBeenCalledWith(null));
    expect(
      screen.queryByRole("button", { name: "Gerar Pix do frete" }),
    ).toBeNull();
    expect(posts()).toHaveLength(0);
  });

  it("preserves a failed creation until a manual check and never automatically reposts", async () => {
    vi.useFakeTimers();
    let posted = false;
    vi.mocked(authorized).mockImplementation(async (_path, options) => {
      if (options?.method === "POST") {
        posted = true;
        throw new Error("Conexão interrompida.");
      }
      if (posted) return { ...pix, pix: null };
      throw notFound();
    });
    view();
    await act(async () => {});
    const input = screen.getByLabelText("CPF do pagador do frete");
    fireEvent.change(input, { target: { value: "52998224725" } });
    fireEvent.submit(input.closest("form")!);
    await act(async () => {});
    expect(screen.getByRole("alert").textContent).toContain(
      "Conexão interrompida.",
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(screen.getByRole("alert").textContent).toContain(
      "Conexão interrompida.",
    );
    expect(posts()).toHaveLength(1);
    fireEvent.submit(input.closest("form")!);
    expect(posts()).toHaveLength(1);
    fireEvent.click(
      screen.getByRole("button", { name: "Atualizar pagamento do frete" }),
    );
    await act(async () => {});
    expect(screen.queryByRole("alert")).toBeNull();
    expect(posts()).toHaveLength(1);
  });

  it("pauses GET polling while hidden and resumes when visible", async () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, "visibilityState", "get");
    visibility.mockReturnValue("hidden");
    vi.mocked(authorized).mockRejectedValue(notFound());
    view();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(authorized).not.toHaveBeenCalled();
    visibility.mockReturnValue("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(authorized).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(authorized).toHaveBeenCalledTimes(2);
    expect(posts()).toHaveLength(0);
  });

  it("ignores late GET callbacks after unmount", async () => {
    const reading = deferred<PixResult>();
    vi.mocked(authorized).mockReturnValue(reading.promise);
    const { props, unmount } = view();
    unmount();
    await act(async () => {
      reading.resolve(pix);
    });
    expect(props.onResolved).not.toHaveBeenCalled();
    expect(props.onBusyChange).not.toHaveBeenCalled();
  });

  it.each(["unmount", "session"])(
    "ignores late POST callbacks after %s",
    async (change) => {
      const creation = deferred<PixResult>();
      let current = true;
      vi.mocked(authorized).mockImplementation(async (_path, options) => {
        if (options?.method === "POST") return creation.promise;
        throw notFound();
      });
      const { props, unmount } = view({ isCurrentSession: () => current });
      const form = await fillCpf();
      fireEvent.submit(form);
      const initialCallbacks = vi.mocked(props.onResolved).mock.calls.length;
      expect(props.onBusyChange).toHaveBeenCalledWith(true);
      if (change === "unmount") unmount();
      else current = false;
      await act(async () => {
        creation.resolve(pix);
      });
      expect(props.onResolved).toHaveBeenCalledTimes(initialCallbacks);
      expect(props.onBusyChange).not.toHaveBeenCalledWith(false);
    },
  );
});
