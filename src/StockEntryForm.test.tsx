// @vitest-environment jsdom
import { StrictMode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StockEntryForm } from "./StockEntryForm";
import type { StockEntryProps } from "./useStockEntry";
import { authorized } from "./session";
import { readPendingEntry, savePendingEntry } from "./stock-entries";
import type { PendingStockEntry } from "./stock-entries";
import type { StockMovement } from "./stock-movements";

vi.mock("./session", () => ({ authorized: vi.fn() }));
const userId = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";
const otherUser = "33333333-3333-4333-8333-333333333333";
const otherProduct = "44444444-4444-4444-8444-444444444444";
const key = "55555555-5555-4555-8555-555555555555";
const storageKey = `jornada-stock-entry:${userId}:${productId}`;
const attempt: PendingStockEntry = {
  key,
  quantity: 3,
  reason: "Compra recebida",
};
const balances = (availableQuantity: number) => ({
  availableQuantity,
  reservedQuantity: 2,
  soldQuantity: 4,
});
function receipt(overrides: Partial<StockMovement> = {}): StockMovement {
  return {
    id: "66666666-6666-4666-8666-666666666666",
    sequence: "9007199254740993",
    type: "STOCK_RECEIPT",
    createdAt: "2026-11-07T12:00:00.000Z",
    product: {
      id: productId,
      cardName: "Pikachu",
      cardNumber: "025",
      setName: "Coleção de teste",
      categoryName: "Avulsas",
      conditionName: "Near Mint",
      languageName: "Português",
    },
    actor: { id: userId, name: "Gestor de teste" },
    order: null,
    reason: attempt.reason,
    before: balances(5),
    change: { availableQuantity: 3, reservedQuantity: 0, soldQuantity: 0 },
    after: balances(8),
    ...overrides,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const failure = (status: number) =>
  Object.assign(new Error("SECRET_INTERNAL_PROVIDER_DETAILS"), { status });
const reads = () =>
  vi
    .mocked(authorized)
    .mock.calls.filter(([, options]) => options?.method === "GET");
const writes = () =>
  vi
    .mocked(authorized)
    .mock.calls.filter(([, options]) => options?.method === "POST");
let onBusyChange = vi.fn<(busy: boolean) => void>();
let onRecorded = vi.fn<() => void>();
function props(changes: Partial<StockEntryProps> = {}): StockEntryProps {
  return {
    userId,
    productId,
    isCurrentSession: () => true,
    onBusyChange,
    onRecorded,
    ...changes,
  };
}
function mount(changes: Partial<StockEntryProps> = {}) {
  return render(<StockEntryForm {...props(changes)} />);
}
function fill(quantity = "3", reason = "Compra recebida") {
  fireEvent.change(screen.getByLabelText("Quantidade de entrada"), {
    target: { value: quantity },
  });
  fireEvent.change(screen.getByLabelText("Motivo da entrada"), {
    target: { value: reason },
  });
}
function review() {
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Revisar entrada" }));
}
beforeEach(() => {
  sessionStorage.clear();
  vi.resetAllMocks();
  onBusyChange = vi.fn<(busy: boolean) => void>();
  onRecorded = vi.fn<() => void>();
  vi.spyOn(crypto, "randomUUID").mockReturnValue(key);
  vi.mocked(authorized).mockResolvedValue(receipt());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Entrada de estoque no cadastro", () => {
  it("abre sem consultas ou entradas automáticas e exige revisão explícita", () => {
    mount();
    expect(authorized).not.toHaveBeenCalled();
    review();
    expect(screen.getByLabelText("Revisão da entrada")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Conferir entrada" })).toBe(
      document.activeElement,
    );
    expect(authorized).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(storageKey)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Editar entrada" }));
    expect(
      screen.getByLabelText<HTMLInputElement>("Quantidade de entrada").value,
    ).toBe("3");
  });
  it("valida campos e foca a quantidade inválida sem enviar", () => {
    mount();
    fill("0", "ab");
    fireEvent.click(screen.getByRole("button", { name: "Revisar entrada" }));
    const quantity = screen.getByLabelText("Quantidade de entrada");
    expect(quantity.getAttribute("aria-invalid")).toBe("true");
    expect(quantity.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.activeElement).toBe(quantity);
    expect(
      screen.getByLabelText("Motivo da entrada").getAttribute("aria-invalid"),
    ).toBe("true");
    expect(authorized).not.toHaveBeenCalled();
  });
  it("persiste os dados antes do POST, confirma uma vez e desbloqueia antes de atualizar o cadastro", async () => {
    const events: string[] = [];
    onBusyChange.mockImplementation((value) => events.push(`busy:${value}`));
    onRecorded.mockImplementation(() => events.push("recorded"));
    vi.mocked(authorized).mockImplementation(async (_path, request) => {
      expect(JSON.parse(sessionStorage.getItem(storageKey)!)).toEqual(attempt);
      expect(new Headers(request?.headers).get("Idempotency-Key")).toBe(key);
      expect(JSON.parse(String(request?.body))).toEqual({
        quantity: 3,
        reason: "Compra recebida",
      });
      return receipt();
    });
    mount();
    review();
    const button = screen.getByRole("button", { name: "Confirmar entrada" });
    fireEvent.click(button);
    fireEvent.click(button);
    await screen.findByText("Entrada registrada. O cadastro será atualizado.");
    expect(writes()).toHaveLength(1);
    expect(reads()).toHaveLength(0);
    expect(sessionStorage.getItem(storageKey)).toBeNull();
    expect(events).toEqual(["busy:true", "busy:false", "recorded"]);
  });
  it("considera somente identidade para finalizar o POST quando parent define disabled durante a gravação", async () => {
    const pending = deferred<unknown>();
    vi.mocked(authorized).mockReturnValue(pending.promise);
    const view = mount();
    review();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar entrada" }));
    view.rerender(<StockEntryForm {...props({ disabled: true })} />);
    await act(async () => {
      pending.resolve(receipt());
      await pending.promise;
    });
    expect(onRecorded).toHaveBeenCalledOnce();
    expect(onBusyChange.mock.calls.map((call) => call[0])).toEqual([
      true,
      false,
    ]);
    expect(readPendingEntry(userId, productId).pending).toBeNull();
  });
  it("guarda a mesma tentativa após falha e só reenvia após clique explícito", async () => {
    vi.mocked(authorized)
      .mockRejectedValueOnce(failure(503))
      .mockResolvedValueOnce(receipt());
    mount();
    review();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar entrada" }));
    await screen.findByText(
      /Não foi possível confirmar a entrada\. Ela pode ter sido registrada/,
    );
    expect(readPendingEntry(userId, productId).pending).toEqual(attempt);
    expect(screen.queryByLabelText("Quantidade de entrada")).toBeNull();
    expect(writes()).toHaveLength(1);
    expect(screen.queryByText(/SECRET_INTERNAL/)).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Reenviar a mesma entrada" }),
    );
    await screen.findByText("Entrada registrada. O cadastro será atualizado.");
    expect(writes()).toHaveLength(2);
    for (const [, options] of writes()) {
      expect(new Headers(options?.headers).get("Idempotency-Key")).toBe(key);
      expect(JSON.parse(String(options?.body))).toEqual({
        quantity: 3,
        reason: attempt.reason,
      });
    }
  });
  it("verifica tentativa salva ao abrir, sem POST e sem bloquear o fechamento do parent", async () => {
    savePendingEntry(userId, productId, attempt);
    mount();
    await waitFor(() => expect(onRecorded).toHaveBeenCalledOnce());
    expect(reads()).toHaveLength(1);
    expect(writes()).toHaveLength(0);
    expect(reads()[0][0]).toBe(
      `/products/${productId}/inventory/entries/${key}`,
    );
    expect(onBusyChange).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(storageKey)).toBeNull();
  });
  it("404 não limpa a tentativa nem libera nova chave", async () => {
    savePendingEntry(userId, productId, attempt);
    vi.mocked(authorized).mockRejectedValue(failure(404));
    mount();
    await screen.findByText(/A entrada ainda não foi confirmada/);
    expect(readPendingEntry(userId, productId).pending).toEqual(attempt);
    expect(
      screen.queryByRole("button", { name: "Revisar entrada" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Verificar entrada" }));
    await waitFor(() => expect(reads()).toHaveLength(2));
    expect(writes()).toHaveLength(0);
    expect(crypto.randomUUID).not.toHaveBeenCalled();
  });
  it("retoma tentativa salva após timeout e desmontagem com o mesmo identificador", async () => {
    vi.useFakeTimers();
    vi.mocked(authorized).mockReturnValueOnce(new Promise(() => {}));
    const view = mount();
    review();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar entrada" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(screen.getByRole("alert").textContent).toMatch(
      /demorou mais que o esperado/,
    );
    expect(readPendingEntry(userId, productId).pending).toEqual(attempt);
    view.unmount();
    vi.useRealTimers();
    vi.mocked(authorized).mockRejectedValueOnce(failure(404));
    mount();
    await screen.findByText(/A entrada ainda não foi confirmada/);
    expect(reads()).toHaveLength(1);
    expect(writes()).toHaveLength(1);
    expect(readPendingEntry(userId, productId).pending?.key).toBe(key);
  });
  it("armazenamento inválido bloqueia campos, gravação e criação de chave", () => {
    sessionStorage.setItem(storageKey, "broken-json");
    mount();
    expect(screen.getByRole("alert").textContent).toMatch(/tentativa salva/);
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Revisar entrada" })
        .disabled,
    ).toBe(true);
    expect(authorized).not.toHaveBeenCalled();
    expect(crypto.randomUUID).not.toHaveBeenCalled();
  });
  it("falha ao persistir a tentativa bloqueia o POST", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("private storage message");
    });
    mount();
    review();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar entrada" }));
    expect(screen.getByRole("alert").textContent).toMatch(
      /proteger esta tentativa/,
    );
    expect(authorized).not.toHaveBeenCalled();
    expect(onBusyChange).not.toHaveBeenCalled();
  });
  it("recibo confirmado com falha ao limpar storage permite somente verificar, nunca outra entrada", async () => {
    const remove = vi
      .spyOn(Storage.prototype, "removeItem")
      .mockImplementation(() => {});
    mount();
    review();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar entrada" }));
    await screen.findByText(/Entrada confirmada\. Não foi possível limpar/);
    expect(onRecorded).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Reenviar a mesma entrada" }),
    ).toBeNull();
    expect(screen.queryByLabelText("Quantidade de entrada")).toBeNull();
    remove.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: "Verificar entrada" }));
    await waitFor(() => expect(onRecorded).toHaveBeenCalledOnce());
    expect(writes()).toHaveLength(1);
    expect(reads()).toHaveLength(1);
    expect(sessionStorage.getItem(storageKey)).toBeNull();
  });
  it.each([401, 403])(
    "erro %s retira dados da tela mas conserva a tentativa para a mesma conta",
    async (status) => {
      savePendingEntry(userId, productId, attempt);
      vi.mocked(authorized).mockRejectedValue(failure(status));
      mount();
      await screen.findByText(/Acesso restrito a administradores/);
      expect(screen.queryByText(attempt.reason)).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Reenviar a mesma entrada" }),
      ).toBeNull();
      expect(readPendingEntry(userId, productId).pending).toEqual(attempt);
      expect(writes()).toHaveLength(0);
    },
  );
  it.each([
    receipt({ actor: { id: otherUser, name: "Outra pessoa" } }),
    receipt({ reason: "Outro motivo" }),
    receipt({
      before: balances(4),
      after: balances(8),
      change: { availableQuantity: 4, reservedQuantity: 0, soldQuantity: 0 },
    }),
  ])(
    "rejeita confirmação com ator, motivo ou quantidade divergente",
    async (invalid) => {
      savePendingEntry(userId, productId, attempt);
      vi.mocked(authorized).mockResolvedValue(invalid);
      mount();
      await screen.findByText(/Não foi possível conferir a confirmação/);
      expect(onRecorded).not.toHaveBeenCalled();
      expect(readPendingEntry(userId, productId).pending).toEqual(attempt);
    },
  );
  it("desmontar aborta o POST e descarta a resposta antiga sem remover a tentativa", async () => {
    const pending = deferred<unknown>();
    vi.mocked(authorized).mockReturnValue(pending.promise);
    const view = mount();
    review();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar entrada" }));
    const signal = writes()[0][1]?.signal;
    view.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      pending.resolve(receipt());
      await pending.promise;
    });
    expect(onRecorded).not.toHaveBeenCalled();
    expect(readPendingEntry(userId, productId).pending).toEqual(attempt);
    expect(onBusyChange.mock.calls.map((call) => call[0])).toEqual([
      true,
      false,
    ]);
  });
  it("nova montagem não aceita a resposta antiga nem troca a tentativa de outro produto", async () => {
    const pending = deferred<unknown>();
    vi.mocked(authorized).mockReturnValueOnce(pending.promise);
    const old = mount();
    review();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar entrada" }));
    old.unmount();
    mount({ userId: otherUser, productId: otherProduct });
    await act(async () => {
      pending.resolve(receipt());
      await pending.promise;
    });
    expect(
      screen.getByLabelText<HTMLInputElement>("Quantidade de entrada").value,
    ).toBe("");
    expect(onRecorded).not.toHaveBeenCalled();
    expect(readPendingEntry(userId, productId).pending).toEqual(attempt);
    expect(readPendingEntry(otherUser, otherProduct).pending).toBeNull();
  });
  it("sessão revogada durante uma gravação ignora confirmação e mantém os dados salvos", async () => {
    let current = true;
    const pending = deferred<unknown>();
    vi.mocked(authorized).mockReturnValue(pending.promise);
    mount({ isCurrentSession: () => current });
    review();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar entrada" }));
    current = false;
    await act(async () => {
      pending.resolve(receipt());
      await pending.promise;
    });
    expect(onRecorded).not.toHaveBeenCalled();
    expect(readPendingEntry(userId, productId).pending).toEqual(attempt);
  });
  it("mount com parent desabilitado não deixa a verificação travada quando habilitado", async () => {
    savePendingEntry(userId, productId, attempt);
    const view = mount({ disabled: true });
    await act(async () => {
      await Promise.resolve();
    });
    expect(authorized).not.toHaveBeenCalled();
    view.rerender(<StockEntryForm {...props({ disabled: false })} />);
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Verificar entrada",
      }).disabled,
    ).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Verificar entrada" }));
    await waitFor(() => expect(onRecorded).toHaveBeenCalledOnce());
    expect(writes()).toHaveLength(0);
  });
  it("StrictMode só verifica a tentativa salva uma vez e nunca a reenvia automaticamente", async () => {
    savePendingEntry(userId, productId, attempt);
    render(
      <StrictMode>
        <StockEntryForm {...props()} />
      </StrictMode>,
    );
    await waitFor(() => expect(onRecorded).toHaveBeenCalledOnce());
    expect(reads()).toHaveLength(1);
    expect(writes()).toHaveLength(0);
    expect(onBusyChange).not.toHaveBeenCalled();
  });
});
