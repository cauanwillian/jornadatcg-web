// @vitest-environment jsdom
import { StrictMode } from "react";
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
import { AdminInventoryArea } from "./AdminInventoryArea";
import { authorized } from "./session";
import type { InventoryPage, InventoryRow } from "./admin-inventory";

vi.mock("./session", () => ({ authorized: vi.fn() }));
const id = (n: number) =>
  `${n.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`;
const date = "2026-11-05T12:30:00.000Z";
const row = (n = 1): InventoryRow => ({
  id: id(n),
  active: true,
  card: {
    id: id(1000 + n),
    name: `Pikachu ${n}`,
    number: "025",
    set: { id: id(4000), name: "Coleção de demonstração" },
  },
  category: { id: id(4001), name: "Cartas avulsas" },
  condition: { id: id(4002), name: "Near Mint" },
  language: { id: id(4003), name: "Português" },
  inventory: {
    availableQuantity: 3,
    reservedQuantity: 1,
    soldQuantity: 12,
    updatedAt: date,
  },
});
let rows: InventoryRow[];
let error: unknown;
const failure = (status: number) =>
  Object.assign(new Error("SECRET_INTERNAL_PROVIDER_PASSWORD"), { status });
function response(query = new URLSearchParams()): InventoryPage {
  const threshold = Number(query.get("lowStockThreshold") ?? 5);
  const stock = query.get("stock");
  const filtered = rows.filter((item) => {
    const inventory = item.inventory;
    return (
      (!query.get("name") ||
        item.card.name
          .toLowerCase()
          .includes(query.get("name")!.toLowerCase())) &&
      (!query.get("active") ||
        item.active === (query.get("active") === "true")) &&
      (!stock ||
        (stock === "missing"
          ? !inventory
          : inventory &&
            (stock === "available"
              ? inventory.availableQuantity > 0
              : stock === "out"
                ? inventory.availableQuantity === 0
                : stock === "low"
                  ? inventory.availableQuantity > 0 &&
                    inventory.availableQuantity <= threshold
                  : stock === "reserved" && inventory.reservedQuantity > 0)))
    );
  });
  const page = Number(query.get("page") ?? 1);
  return {
    items: structuredClone(filtered.slice((page - 1) * 20, page * 20)),
    page,
    pageSize: 20,
    total: filtered.length,
    lowStockThreshold: threshold,
    summary: {
      productCount: filtered.length,
      availableCount: filtered.filter(
        (item) => item.inventory && item.inventory.availableQuantity > 0,
      ).length,
      outOfStockCount: filtered.filter(
        (item) => item.inventory?.availableQuantity === 0,
      ).length,
      lowStockCount: filtered.filter(
        (item) =>
          item.inventory &&
          item.inventory.availableQuantity > 0 &&
          item.inventory.availableQuantity <= threshold,
      ).length,
      reservedCount: filtered.filter(
        (item) => item.inventory && item.inventory.reservedQuantity > 0,
      ).length,
      missingInventoryCount: filtered.filter((item) => !item.inventory).length,
    },
  };
}
async function server(path: string) {
  if (error) throw error;
  const url = new URL(path, "http://localhost");
  if (url.pathname !== "/admin/inventory")
    throw new Error(`Unexpected route ${path}`);
  return response(url.searchParams);
}
const queryAt = (index = -1) =>
  new URL(vi.mocked(authorized).mock.calls.at(index)![0], "http://localhost")
    .searchParams;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function mount(props: Partial<Parameters<typeof AdminInventoryArea>[0]> = {}) {
  return render(
    <AdminInventoryArea isCurrentSession={() => true} {...props} />,
  );
}
const ready = () => screen.findByRole("heading", { name: "Pikachu 1" });
beforeEach(() => {
  rows = [row()];
  error = undefined;
  vi.mocked(authorized).mockReset();
  vi.mocked(authorized).mockImplementation(server as typeof authorized);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Visão administrativa de estoque", () => {
  it("consulta saldos e resumo sem comandos ou chamadas ao provedor", async () => {
    mount();
    await ready();
    expect(queryAt().get("page")).toBe("1");
    expect(queryAt().get("pageSize")).toBe("20");
    expect(queryAt().get("lowStockThreshold")).toBe("5");
    expect(
      screen.getByText("Estoque atualizado em", { exact: false }),
    ).toBeTruthy();
    const quantities = screen.getByRole("article", {
      name: "Estoque de Pikachu 1",
    });
    expect(within(quantities).getByText("12")).toBeTruthy();
    expect(within(quantities).getByText("Reservadas")).toBeTruthy();
    expect(
      vi
        .mocked(authorized)
        .mock.calls.every(
          ([path, request]) =>
            path.startsWith("/admin/inventory?") &&
            request?.method === "GET" &&
            request.cache === "no-store",
        ),
    ).toBe(true);
  });
  it("exibe resumo do conjunto inteiro e navega por páginas no servidor", async () => {
    rows = Array.from({ length: 25 }, (_, n) => row(n + 1));
    mount();
    await ready();
    const summary = screen.getByLabelText("Resumo do estoque filtrado");
    expect(within(summary).getAllByText("25")).toHaveLength(4);
    expect(screen.getAllByRole("article")).toHaveLength(20);
    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    await screen.findByRole("heading", { name: "Pikachu 21" });
    expect(queryAt().get("page")).toBe("2");
    expect(screen.getAllByRole("article")).toHaveLength(5);
    expect(
      within(screen.getByLabelText("Resumo do estoque filtrado")).getAllByText(
        "25",
      ),
    ).toHaveLength(4);
    expect(screen.queryByRole("heading", { name: "Pikachu 1" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Anterior" }));
    await ready();
    expect(queryAt().get("page")).toBe("1");
  });
  it("aplica nome, anúncio, situação e limite somente após enviar o formulário", async () => {
    rows.push({ ...row(2), active: false });
    mount();
    await ready();
    fireEvent.change(screen.getByLabelText("Nome da carta"), {
      target: { value: "  Pikachu 2  " },
    });
    fireEvent.change(screen.getByLabelText("Status do anúncio"), {
      target: { value: "false" },
    });
    fireEvent.change(screen.getByLabelText("Situação do estoque"), {
      target: { value: "low" },
    });
    fireEvent.change(screen.getByLabelText("Limite de estoque baixo"), {
      target: { value: "4" },
    });
    expect(authorized).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Aplicar filtros" }));
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(1));
    expect(queryAt().get("name")).toBe("Pikachu 2");
    expect(queryAt().get("active")).toBe("false");
    expect(queryAt().get("stock")).toBe("low");
    expect(queryAt().get("lowStockThreshold")).toBe("4");
    expect(screen.getByText("Anúncio inativo")).toBeTruthy();
  });
  it.each([15, 0])(
    "permite retornar da página 2 quando o total cai para %s produtos",
    async (total) => {
      rows = Array.from({ length: 25 }, (_, n) => row(n + 1));
      mount();
      await ready();
      fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
      await screen.findByRole("heading", { name: "Pikachu 21" });
      rows = rows.slice(0, total);
      fireEvent.click(
        screen.getByRole("button", { name: "Atualizar estoque" }),
      );
      await screen.findByText(
        "A lista mudou e esta página ficou vazia. Consulte a primeira página para ver os resultados atuais.",
      );
      expect(
        screen.queryByText(
          "Nenhum produto encontrado para os filtros aplicados.",
        ),
      ).toBeNull();
      fireEvent.click(
        screen.getByRole("button", { name: "Voltar à primeira página" }),
      );
      if (total) await ready();
      else
        await screen.findByText(
          "Nenhum produto encontrado para os filtros aplicados.",
        );
      expect(queryAt().get("page")).toBe("1");
      expect(queryAt().get("lowStockThreshold")).toBe("5");
      expect(screen.queryAllByRole("article")).toHaveLength(total);
      expect(
        screen.queryByRole("button", { name: "Voltar à primeira página" }),
      ).toBeNull();
    },
  );
  it("atualizar preserva filtros aplicados e não aplica um rascunho novo", async () => {
    mount();
    await ready();
    fireEvent.change(screen.getByLabelText("Nome da carta"), {
      target: { value: "Não aplicar" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Atualizar estoque" }));
    await ready();
    expect(queryAt().has("name")).toBe(false);
    expect(screen.getByLabelText<HTMLInputElement>("Nome da carta").value).toBe(
      "Não aplicar",
    );
  });
  it("limpar restaura o limite padrão e a primeira página", async () => {
    mount();
    await ready();
    fireEvent.change(screen.getByLabelText("Limite de estoque baixo"), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText("Situação do estoque"), {
      target: { value: "available" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar filtros" }));
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Limpar filtros" }));
    await ready();
    expect(queryAt().get("lowStockThreshold")).toBe("5");
    expect(queryAt().has("stock")).toBe(false);
    expect(queryAt().get("page")).toBe("1");
    expect(
      screen.getByLabelText<HTMLInputElement>("Limite de estoque baixo").value,
    ).toBe("5");
  });
  it("valida e foca o limite inválido sem consultar a API", async () => {
    mount();
    await ready();
    const input = screen.getByLabelText("Limite de estoque baixo");
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar filtros" }));
    expect(authorized).toHaveBeenCalledTimes(1);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(input);
    expect(
      document.getElementById(input.getAttribute("aria-describedby")!)
        ?.textContent,
    ).toBeTruthy();
    fireEvent.change(input, { target: { value: "5" } });
    expect(input.getAttribute("aria-invalid")).toBe("false");
  });
  it("distingue estoque ausente de esgotado e não inventa quantidades", async () => {
    rows = [
      { ...row(1), inventory: null },
      { ...row(2), inventory: { ...row(2).inventory!, availableQuantity: 0 } },
    ];
    mount();
    await ready();
    const missing = screen.getByRole("article", {
      name: "Estoque de Pikachu 1",
    });
    expect(within(missing).getByText("Sem estoque cadastrado")).toBeTruthy();
    expect(within(missing).queryByText("Disponíveis")).toBeNull();
    expect(within(missing).queryByText("0")).toBeNull();
    const exhausted = screen.getByRole("article", {
      name: "Estoque de Pikachu 2",
    });
    expect(within(exhausted).getByText("Esgotado")).toBeTruthy();
    expect(within(exhausted).getByText("Com reservas")).toBeTruthy();
    expect(within(exhausted).getByText("0")).toBeTruthy();
  });
  it("envia somente o identificador do produto escolhido por ação explícita", async () => {
    const onOpenProduct = vi.fn();
    mount({ onOpenProduct });
    await ready();
    expect(onOpenProduct).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Gerenciar produto Pikachu 1" }),
    );
    expect(onOpenProduct).toHaveBeenCalledExactlyOnceWith(id(1));
    expect(authorized).toHaveBeenCalledTimes(1);
  });
  it("não oferece navegação sem callback", async () => {
    mount();
    await ready();
    expect(
      screen.queryByRole("button", { name: /Gerenciar produto/ }),
    ).toBeNull();
  });
  it("não abre produto com sessão já invalidada, mesmo antes de renderizar novamente", async () => {
    let valid = true;
    const onOpenProduct = vi.fn();
    mount({ isCurrentSession: () => valid, onOpenProduct });
    await ready();
    valid = false;
    fireEvent.click(
      screen.getByRole("button", { name: "Gerenciar produto Pikachu 1" }),
    );
    expect(onOpenProduct).not.toHaveBeenCalled();
  });
  it("não consulta nem renderiza quando a sessão inicial não é atual", async () => {
    mount({ isCurrentSession: () => false });
    await act(async () => {});
    expect(authorized).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("region", { name: "Visão de estoque" }),
    ).toBeNull();
  });
  it.each([401, 403])(
    "retira dados e formulário após %s sem exibir erro interno",
    async (status) => {
      mount();
      await ready();
      error = failure(status);
      fireEvent.click(
        screen.getByRole("button", { name: "Atualizar estoque" }),
      );
      await screen.findByRole("alert");
      expect(screen.queryByRole("article")).toBeNull();
      expect(screen.queryByLabelText("Nome da carta")).toBeNull();
      expect(
        screen.queryByText("SECRET_INTERNAL_PROVIDER_PASSWORD"),
      ).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Tentar novamente" }),
      ).toBeNull();
    },
  );
  it("mostra erro fixo, retira o resumo antigo e permite consultar novamente", async () => {
    mount();
    await ready();
    error = failure(503);
    fireEvent.click(screen.getByRole("button", { name: "Atualizar estoque" }));
    await screen.findByRole("alert");
    expect(screen.queryByLabelText("Resumo do estoque filtrado")).toBeNull();
    expect(screen.queryByRole("article")).toBeNull();
    expect(screen.queryByText("SECRET_INTERNAL_PROVIDER_PASSWORD")).toBeNull();
    error = undefined;
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    await ready();
    expect(authorized).toHaveBeenCalledTimes(3);
  });
  it("recusa resposta inválida sem expor conteúdo bruto", async () => {
    vi.mocked(authorized).mockResolvedValue({
      secret: "SECRET_INTERNAL_PROVIDER_PASSWORD",
    });
    mount();
    await screen.findByRole("alert");
    expect(screen.queryByRole("article")).toBeNull();
    expect(document.body.textContent).not.toContain(
      "SECRET_INTERNAL_PROVIDER_PASSWORD",
    );
  });
  it("mostra lista vazia e indicadores zerados sem erro", async () => {
    rows = [];
    mount();
    await screen.findByText(
      "Nenhum produto encontrado para os filtros aplicados.",
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      within(screen.getByLabelText("Resumo do estoque filtrado")).getAllByText(
        "0",
      ),
    ).toHaveLength(6);
  });
  it("bloqueia filtros e repetição enquanto a consulta está pendente", async () => {
    const pending = deferred<InventoryPage>();
    vi.mocked(authorized).mockReturnValue(pending.promise);
    mount();
    await screen.findByRole("status");
    expect(
      screen.getByLabelText<HTMLInputElement>("Nome da carta").disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Atualizar estoque" }));
    fireEvent.submit(screen.getByLabelText("Nome da carta").closest("form")!);
    expect(authorized).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(response()));
    await ready();
  });
  it("aborta a consulta ao desmontar e ignora sua resposta em outra tela", async () => {
    const pending = deferred<InventoryPage>();
    vi.mocked(authorized).mockReturnValueOnce(pending.promise);
    const old = mount();
    await waitFor(() => expect(authorized).toHaveBeenCalledTimes(1));
    const signal = vi.mocked(authorized).mock.calls[0][1]?.signal;
    const previous = response();
    old.unmount();
    expect(signal?.aborted).toBe(true);
    rows = [row(2)];
    mount();
    await screen.findByRole("heading", { name: "Pikachu 2" });
    await act(async () => pending.resolve(previous));
    expect(screen.queryByRole("heading", { name: "Pikachu 1" })).toBeNull();
    expect(screen.getAllByRole("article")).toHaveLength(1);
  });
  it("descarta resultado que chega após a sessão ser invalidada", async () => {
    let valid = true;
    const pending = deferred<InventoryPage>();
    vi.mocked(authorized).mockReturnValue(pending.promise);
    const view = mount({ isCurrentSession: () => valid });
    await waitFor(() => expect(authorized).toHaveBeenCalledTimes(1));
    valid = false;
    await act(async () => pending.resolve(response()));
    view.rerender(<AdminInventoryArea isCurrentSession={() => false} />);
    expect(screen.queryByRole("article")).toBeNull();
    expect(screen.queryByLabelText("Resumo do estoque filtrado")).toBeNull();
  });
  it("monta em StrictMode sem duplicar a leitura", async () => {
    render(
      <StrictMode>
        <AdminInventoryArea isCurrentSession={() => true} />
      </StrictMode>,
    );
    await ready();
    expect(authorized).toHaveBeenCalledTimes(1);
  });
});
