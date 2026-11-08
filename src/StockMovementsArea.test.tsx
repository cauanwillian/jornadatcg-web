// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StockMovementsArea } from "./StockMovementsArea";
import { authorized } from "./session";
import type { StockMovement, StockMovementsPage } from "./stock-movements";

vi.mock("./session", () => ({ authorized: vi.fn() }));
const id = (n: number) =>
  `${n.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`;
const date = "2026-11-06T12:00:00.000Z";
function row(n = 100, changes: Partial<StockMovement> = {}): StockMovement {
  return {
    id: id(n),
    sequence: String(n),
    type: "MANUAL_ADJUSTMENT",
    createdAt: date,
    product: {
      id: id(2),
      cardName: "Pikachu original",
      cardNumber: "025",
      setName: "Coleção da compra",
      categoryName: "Avulsas",
      conditionName: "Near Mint",
      languageName: "Português",
    },
    actor: { id: id(4), name: "Administrador de teste" },
    order: null,
    reason: "Conferência de estoque",
    before: { availableQuantity: 5, reservedQuantity: 1, soldQuantity: 12 },
    change: { availableQuantity: -2, reservedQuantity: 0, soldQuantity: 0 },
    after: { availableQuantity: 3, reservedQuantity: 1, soldQuantity: 12 },
    ...changes,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let rows: StockMovement[];
let failure: Error | undefined;
let pending: Promise<unknown> | undefined;
function server(path: string) {
  if (failure) throw failure;
  if (pending) return pending;
  const url = new URL(path, "http://localhost"),
    query = url.searchParams;
  if (url.pathname !== "/admin/inventory/movements")
    throw new Error("Rota inesperada");
  const page = Number(query.get("page"));
  const filtered = rows.filter(
    (value) =>
      (!query.get("productId") ||
        value.product.id === query.get("productId")) &&
      (!query.get("type") || value.type === query.get("type")) &&
      (!query.get("from") || value.createdAt >= query.get("from")!) &&
      (!query.get("to") || value.createdAt < query.get("to")!),
  );
  return {
    items: structuredClone(filtered.slice((page - 1) * 20, page * 20)),
    page,
    pageSize: 20,
    total: filtered.length,
  };
}
beforeEach(() => {
  rows = [row()];
  failure = undefined;
  pending = undefined;
  vi.mocked(authorized).mockReset();
  vi.mocked(authorized).mockImplementation(async (path) => server(path));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function mount(props: Partial<Parameters<typeof StockMovementsArea>[0]> = {}) {
  return render(
    <StockMovementsArea isCurrentSession={() => true} {...props} />,
  );
}
const reads = () => vi.mocked(authorized).mock.calls;
const settle = () =>
  screen.findByRole("article", { name: "Ajuste manual de Pikachu original" });
describe("Histórico administrativo de estoque", () => {
  it("consulta apenas por GET e apresenta snapshots, motivo, responsável e saldos", async () => {
    mount();
    const entry = await settle();
    expect(reads()).toHaveLength(1);
    expect(reads()[0][0]).toBe("/admin/inventory/movements?page=1&pageSize=20");
    expect(reads()[0][1]).toMatchObject({ method: "GET", cache: "no-store" });
    expect(within(entry).getByText("Pikachu original")).toBeTruthy();
    expect(entry.textContent).toContain("Coleção da compra");
    expect(entry.textContent).toContain("Conferência de estoque");
    expect(entry.textContent).toContain("Administrador de teste");
    const cells = within(entry).getAllByRole("row");
    expect(cells[1].textContent).toBe("Disponíveis5−23");
    expect(cells[2].textContent).toBe("Reservadas101");
    expect(cells[3].textContent).toBe("Vendidas12012");
    expect(
      screen.queryByRole("button", { name: /Confirmar|Excluir|Editar/ }),
    ).toBeNull();
  });
  it("identifica abertura capturada, sem inventar operações anteriores", async () => {
    rows = [
      row(100, {
        type: "OPENING_BALANCE",
        actor: null,
        reason: null,
        before: { availableQuantity: 0, reservedQuantity: 0, soldQuantity: 0 },
        change: row().after,
      }),
    ];
    mount();
    await screen.findByRole("article", {
      name: "Abertura do histórico de Pikachu original",
    });
    expect(
      screen.getByText(/Saldo capturado na abertura do histórico/),
    ).toBeTruthy();
    expect(screen.getByText("Abertura na implantação")).toBeTruthy();
  });
  it("mostra origem de pedido e variações positivas sem expor identificadores", async () => {
    rows = [
      row(100, {
        type: "ORDER_CANCELLED",
        actor: null,
        order: { id: null, orderNumber: 18 },
        before: { availableQuantity: 3, reservedQuantity: 2, soldQuantity: 12 },
        change: { availableQuantity: 2, reservedQuantity: -2, soldQuantity: 0 },
        after: { availableQuantity: 5, reservedQuantity: 0, soldQuantity: 12 },
      }),
    ];
    mount();
    const entry = await screen.findByRole("article", {
      name: "Cancelamento de pedido de Pikachu original",
    });
    expect(entry.textContent).toContain(
      "Origem: sistema / pedido · Pedido #18",
    );
    expect(entry.textContent).toContain("+2");
    expect(entry.textContent).not.toContain(id(2));
  });
  it("não atribui ajuste manual sem ator ao sistema", async () => {
    rows = [row(100, { actor: null })];
    mount();
    await settle();
    expect(screen.getByText("Responsável não informado")).toBeTruthy();
  });
  it("abre escopo pelo produto e mantém escopo ao limpar filtros", async () => {
    mount({ initialProductId: id(2) });
    await settle();
    expect(reads()[0][0]).toContain(`productId=${id(2)}`);
    expect(
      screen.getByText("Produto selecionado no estoque: Pikachu original."),
    ).toBeTruthy();
    fireEvent.change(
      screen.getByRole("combobox", { name: "Tipo de movimentação" }),
      { target: { value: "MANUAL_ADJUSTMENT" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Aplicar filtros" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Limpar filtros" }));
    await settle();
    expect(reads().at(-1)![0]).toContain(`productId=${id(2)}`);
    expect(reads().at(-1)![0]).not.toContain("type=");
  });
  it("histórico geral remove escopo e outros filtros explicitamente", async () => {
    mount({ initialProductId: id(2) });
    await settle();
    fireEvent.change(
      screen.getByRole("combobox", { name: "Tipo de movimentação" }),
      { target: { value: "MANUAL_ADJUSTMENT" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Aplicar filtros" }));
    await settle();
    fireEvent.click(
      screen.getByRole("button", { name: "Ver histórico geral" }),
    );
    await settle();
    expect(reads().at(-1)![0]).toBe(
      "/admin/inventory/movements?page=1&pageSize=20",
    );
    expect(
      screen.queryByRole("button", { name: "Ver histórico geral" }),
    ).toBeNull();
  });
  it("não consulta por digitação e aplica datas locais somente no envio", async () => {
    mount();
    await settle();
    fireEvent.change(
      screen.getByRole("combobox", { name: "Tipo de movimentação" }),
      { target: { value: "MANUAL_ADJUSTMENT" } },
    );
    fireEvent.change(screen.getByLabelText("De", { exact: true }), {
      target: { value: "2026-11-06" },
    });
    fireEvent.change(screen.getByLabelText("Até", { exact: true }), {
      target: { value: "2026-11-06" },
    });
    expect(reads()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Aplicar filtros" }));
    await settle();
    const params = new URL(reads().at(-1)![0], "http://localhost").searchParams;
    expect(params.get("type")).toBe("MANUAL_ADJUSTMENT");
    expect(params.get("from")).toBe(
      new Date("2026-11-06T00:00:00").toISOString(),
    );
    expect(params.get("to")).toBe(
      new Date("2026-11-07T00:00:00").toISOString(),
    );
  });
  it("valida intervalo e foca o erro sem consultar", async () => {
    mount();
    await settle();
    fireEvent.change(screen.getByLabelText("De", { exact: true }), {
      target: { value: "2026-11-07" },
    });
    fireEvent.change(screen.getByLabelText("Até", { exact: true }), {
      target: { value: "2026-11-06" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar filtros" }));
    expect(
      screen.getByText("A data final deve ser igual ou posterior à inicial."),
    ).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByLabelText("Até", { exact: true }),
    );
    expect(reads()).toHaveLength(1);
  });
  it("atualiza filtros aplicados sem enviar rascunhos", async () => {
    mount();
    await settle();
    fireEvent.change(
      screen.getByRole("combobox", { name: "Tipo de movimentação" }),
      { target: { value: "MANUAL_ADJUSTMENT" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Atualizar histórico" }),
    );
    await settle();
    expect(reads().at(-1)![0]).not.toContain("type=");
  });
  it("pagina no servidor e preserva total sem carregar tudo", async () => {
    rows = Array.from({ length: 21 }, (_, index) => row(100 - index));
    mount();
    await waitFor(() =>
      expect(screen.getAllByRole("article")).toHaveLength(20),
    );
    expect(screen.getByText(/21 movimentações encontradas/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(1));
    expect(reads().at(-1)![0]).toContain("page=2");
    expect(screen.getByText("Página 2 de 2")).toBeTruthy();
  });
  it.each([0, 15])(
    "permite voltar quando página fica fora do total %s",
    async (total) => {
      rows = Array.from({ length: 21 }, (_, index) => row(100 - index));
      mount();
      await waitFor(() =>
        expect(screen.getAllByRole("article")).toHaveLength(20),
      );
      fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
      await screen.findByText("Página 2 de 2");
      rows = rows.slice(0, total);
      fireEvent.click(
        screen.getByRole("button", { name: "Atualizar histórico" }),
      );
      const back = await screen.findByRole("button", {
        name: "Voltar à primeira página",
      });
      expect(
        screen.queryByText(
          "Nenhuma movimentação registrada para os filtros aplicados.",
        ),
      ).toBeNull();
      fireEvent.click(back);
      await waitFor(() => expect(reads().at(-1)![0]).toContain("page=1"));
      if (total)
        await waitFor(() =>
          expect(screen.getAllByRole("article")).toHaveLength(total),
        );
      else
        await screen.findByText(
          "Nenhuma movimentação registrada para os filtros aplicados.",
        );
    },
  );
  it("representa histórico vazio sem saldos inventados", async () => {
    rows = [];
    mount();
    await screen.findByText(
      "Nenhuma movimentação registrada para os filtros aplicados.",
    );
    expect(screen.queryByRole("table")).toBeNull();
  });
  it("sanitiza falha e repete somente leitura por ação explícita", async () => {
    failure = Object.assign(new Error("SECRET_INTERNAL"), { status: 503 });
    mount();
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).not.toContain(
      "SECRET_INTERNAL",
    );
    expect(reads()).toHaveLength(1);
    failure = undefined;
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    await settle();
    expect(reads()).toHaveLength(2);
    expect(reads().every(([, request]) => request?.method === "GET")).toBe(
      true,
    );
  });
  it.each([401, 403])(
    "retira dados pessoais e filtros ao receber %s",
    async (status) => {
      mount({ initialProductId: id(2) });
      await settle();
      failure = Object.assign(new Error("SECRET_INTERNAL"), { status });
      fireEvent.click(
        screen.getByRole("button", { name: "Atualizar histórico" }),
      );
      await screen.findByText(/Acesso restrito a administradores/);
      expect(screen.queryByText("Administrador de teste")).toBeNull();
      expect(screen.queryByText("Pikachu original")).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Ver histórico geral" }),
      ).toBeNull();
    },
  );
  it("aborta consulta e ignora resposta após desmontagem", async () => {
    const gate = deferred<StockMovementsPage>();
    pending = gate.promise;
    const view = mount();
    await waitFor(() => expect(reads()).toHaveLength(1));
    const signal = reads()[0][1]?.signal;
    view.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      gate.resolve({ items: [row()], page: 1, pageSize: 20, total: 1 });
      await gate.promise;
    });
    expect(screen.queryByText("Pikachu original")).toBeNull();
  });
  it("ignora resposta que deixou de pertencer à sessão", async () => {
    const gate = deferred<StockMovementsPage>();
    pending = gate.promise;
    let current = true;
    const view = mount({ isCurrentSession: () => current });
    await waitFor(() => expect(reads()).toHaveLength(1));
    current = false;
    view.rerender(<StockMovementsArea isCurrentSession={() => current} />);
    await act(async () => {
      gate.resolve({ items: [row()], page: 1, pageSize: 20, total: 1 });
      await gate.promise;
    });
    expect(
      screen.queryByRole("region", { name: "Histórico de estoque" }),
    ).toBeNull();
  });
  it("recusa ID inicial inválido sem enviar o identificador", async () => {
    mount({ initialProductId: "01" });
    await settle();
    expect(reads()[0][0]).not.toContain("productId");
  });
});
