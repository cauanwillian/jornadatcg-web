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
import { AdminCardsArea } from "./AdminCardsArea";
import { authorized } from "./session";
import type { ExternalCard } from "./admin-cards";
import type { LocalCard } from "./admin-products";

vi.mock("./session", () => ({ authorized: vi.fn() }));
const id = "11111111-1111-4111-8111-111111111111";
const setId = "22222222-2222-4222-8222-222222222222";
const externalCard: ExternalCard = {
  externalId: "tcggo_123",
  name: "Pikachu",
  number: "025",
  set: { externalId: "tcggo_set_12", name: "Fagulhas", printedTotal: 182 },
  rarity: "Rare",
  artist: "Artista de exemplo",
  images: { small: null, large: null },
};
const localCard: LocalCard = {
  ...externalCard,
  id,
  set: {
    ...externalCard.set,
    id: setId,
    series: null,
    code: null,
    total: 200,
    releaseDate: null,
    logoUrl: null,
    symbolUrl: null,
  },
  createdAt: "2026-10-26T12:00:00.000Z",
  updatedAt: "2026-10-26T12:00:00.000Z",
};
const noop = () => {};
const clone = <T,>(data: T) => structuredClone(data);
let localRows: LocalCard[];
let remoteRows: ExternalCard[];
let readError: unknown;
let searchError: unknown;
let importError: unknown;
const failure = (status: number) =>
  Object.assign(new Error("SECRET_INTERNAL"), { status });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function server(path: string, options: RequestInit = {}) {
  const url = new URL(path, "http://localhost");
  if (url.pathname === "/cards/search") {
    if (searchError) throw searchError;
    return clone(remoteRows);
  }
  if (url.pathname === "/cards/import") {
    if (importError) throw importError;
    expect(options.method).toBe("POST");
    const externalId = JSON.parse(String(options.body)).externalId as string;
    const card = { ...clone(localCard), externalId };
    if (!localRows.some((row) => row.externalId === externalId))
      localRows.push(card);
    return card;
  }
  if (readError) throw readError;
  if (url.pathname === `/cards/${id}`) return clone(localCard);
  if (url.pathname === "/cards") {
    const page = Number(url.searchParams.get("page"));
    const name = url.searchParams.get("name")?.toLowerCase() ?? "";
    const rows = localRows.filter((row) =>
      row.name.toLowerCase().includes(name),
    );
    return {
      data: clone(rows.slice((page - 1) * 12, page * 12)),
      pagination: {
        page,
        limit: 12,
        total: rows.length,
        totalPages: Math.ceil(rows.length / 12),
      },
    };
  }
  throw new Error("Unexpected request");
}
beforeEach(() => {
  localRows = [clone(localCard)];
  remoteRows = [clone(externalCard)];
  readError = undefined;
  searchError = undefined;
  importError = undefined;
  vi.mocked(authorized).mockReset();
  vi.mocked(authorized).mockImplementation(server as typeof authorized);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function mount(props: Partial<Parameters<typeof AdminCardsArea>[0]> = {}) {
  return render(
    <AdminCardsArea
      isCurrentSession={() => true}
      onBusyChange={noop}
      {...props}
    />,
  );
}
async function localReady() {
  await screen.findByRole("button", { name: "Ver detalhes de Pikachu" });
}
async function externalView() {
  await localReady();
  fireEvent.click(screen.getByRole("button", { name: "Pesquisar na API" }));
}
async function searchByName() {
  await externalView();
  fireEvent.change(screen.getByLabelText("Nome (opcional)"), {
    target: { value: "Pikachu" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Pesquisar cartas" }));
  await screen.findByRole("button", { name: "Revisar Pikachu" });
}
const calls = () => vi.mocked(authorized).mock.calls;
const imports = () => calls().filter(([path]) => path === "/cards/import");

describe("Biblioteca administrativa de cartas", () => {
  it("carrega a biblioteca local sem consultar o provedor", async () => {
    mount();
    await localReady();
    expect(calls()).toHaveLength(1);
    expect(calls()[0]?.[0]).toBe("/cards?page=1&limit=12");
    expect(calls()[0]?.[1]).toMatchObject({ method: "GET", cache: "no-store" });
    expect(screen.getByText("1 carta cadastrada.")).toBeTruthy();
    expect(imports()).toHaveLength(0);
  });
  it("não consulta automaticamente ao abrir pesquisa externa", async () => {
    mount();
    await externalView();
    expect(calls()).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Pesquisar cartas" }),
    ).toBeTruthy();
  });
  it("rejeita pesquisa sem nome nem código sem fazer requisição", async () => {
    mount();
    await externalView();
    fireEvent.click(screen.getByRole("button", { name: "Pesquisar cartas" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("Informe o nome"),
    );
    expect(calls()).toHaveLength(1);
  });
  it("pesquisa por nome e só importa depois de revisar e confirmar", async () => {
    const products = vi.fn();
    mount({ onOpenProducts: products });
    await searchByName();
    expect(calls()[1]?.[0]).toBe("/cards/search?name=Pikachu");
    fireEvent.click(screen.getByRole("button", { name: "Revisar Pikachu" }));
    const detail = screen.getByRole("region", { name: "Detalhes da carta" });
    expect(within(detail).getByText("025/182")).toBeTruthy();
    expect(within(detail).getByText("Artista de exemplo")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Pikachu" })).toBe(
      document.activeElement,
    );
    expect(imports()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Importar carta" }));
    expect(await screen.findByRole("status")).toHaveProperty(
      "textContent",
      "Carta disponível na biblioteca.",
    );
    expect(imports()).toHaveLength(1);
    expect(JSON.parse(String(imports()[0]?.[1]?.body))).toEqual({
      externalId: "tcggo_123",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Ir para gestão de produtos" }),
    );
    expect(products).toHaveBeenCalledOnce();
    expect(calls().every(([path]) => !path.startsWith("/products"))).toBe(true);
  });
  it("preserva código 025/182 e combina os campos na pesquisa", async () => {
    mount();
    await externalView();
    fireEvent.change(screen.getByLabelText("Nome (opcional)"), {
      target: { value: " Pikachu " },
    });
    fireEvent.change(screen.getByLabelText("Código da carta (opcional)"), {
      target: { value: "025/182" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Pesquisar cartas" }));
    await screen.findByRole("button", { name: "Revisar Pikachu" });
    expect(calls()[1]?.[0]).toBe("/cards/search?name=Pikachu&code=025%2F182");
  });
  it("rejeita código inválido sem acessar API", async () => {
    mount();
    await externalView();
    fireEvent.change(screen.getByLabelText("Código da carta (opcional)"), {
      target: { value: "025-182" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Pesquisar cartas" }));
    expect(
      screen
        .getByLabelText("Código da carta (opcional)")
        .getAttribute("aria-invalid"),
    ).toBe("true");
    expect(screen.getByText(/Use número\/total/)).toBeTruthy();
    expect(calls()).toHaveLength(1);
  });
  it("mostra resultado externo vazio", async () => {
    remoteRows = [];
    mount();
    await externalView();
    fireEvent.change(screen.getByLabelText("Código da carta (opcional)"), {
      target: { value: "025/182" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Pesquisar cartas" }));
    expect(
      await screen.findByText(
        "Nenhuma carta encontrada. Tente outro nome ou código.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Importar carta" })).toBeNull();
  });
  it("pagina os resultados externos localmente sem novas consultas", async () => {
    remoteRows = Array.from({ length: 13 }, (_, index) => ({
      ...clone(externalCard),
      externalId: `tcggo_${index + 1}`,
      name: `Carta ${index + 1}`,
    }));
    mount();
    await externalView();
    fireEvent.change(screen.getByLabelText("Nome (opcional)"), {
      target: { value: "Carta" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Pesquisar cartas" }));
    await screen.findByRole("button", { name: "Revisar Carta 1" });
    expect(
      screen.getByText("13 cartas retornadas nesta pesquisa."),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Revisar Carta 13" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    expect(
      screen.getByRole("button", { name: "Revisar Carta 13" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Revisar Carta 1" }),
    ).toBeNull();
    expect(calls()).toHaveLength(2);
  });
  it("consulta detalhe local atualizado sem importar", async () => {
    mount();
    await localReady();
    fireEvent.click(
      screen.getByRole("button", { name: "Ver detalhes de Pikachu" }),
    );
    await screen.findByRole("heading", { name: "Pikachu" });
    expect(calls()[1]?.[0]).toBe(`/cards/${id}`);
    expect(screen.queryByRole("button", { name: "Importar carta" })).toBeNull();
    expect(imports()).toHaveLength(0);
  });
  it("filtra e pagina biblioteca usando nome aplicado", async () => {
    localRows = Array.from({ length: 13 }, (_, index) => ({
      ...clone(localCard),
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      externalId: `tcggo_${index + 1}`,
      name: index === 12 ? "Pikachu" : `Pikachu ${index + 1}`,
    }));
    mount();
    await screen.findByRole("button", { name: "Ver detalhes de Pikachu 1" });
    fireEvent.change(screen.getByLabelText("Nome da carta"), {
      target: { value: " Pikachu " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Filtrar cartas" }));
    await waitFor(() =>
      expect(calls().at(-1)?.[0]).toBe("/cards?page=1&limit=12&name=Pikachu"),
    );
    await screen.findByText("13 cartas cadastradas para esta pesquisa.");
    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    await screen.findByRole("button", { name: "Ver detalhes de Pikachu" });
    expect(calls().at(-1)?.[0]).toBe("/cards?page=2&limit=12&name=Pikachu");
  });
  it("mostra biblioteca vazia e permite pesquisa externa", async () => {
    localRows = [];
    mount();
    expect(
      await screen.findByText(/Nenhuma carta encontrada na biblioteca/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pesquisar na API" }));
    expect(
      screen.getByRole("button", { name: "Pesquisar cartas" }),
    ).toBeTruthy();
    expect(calls()).toHaveLength(1);
  });
  it("mostra falha externa sanitizada e preserva consulta local", async () => {
    searchError = failure(503);
    mount();
    await externalView();
    fireEvent.change(screen.getByLabelText("Nome (opcional)"), {
      target: { value: "Pikachu" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Pesquisar cartas" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("pesquisa externa está indisponível"),
    );
    expect(screen.queryByText(/SECRET_INTERNAL/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cartas cadastradas" }));
    await localReady();
    expect(imports()).toHaveLength(0);
  });
  it("não repete importação incerta e retoma somente o mesmo identificador por ação explícita", async () => {
    importError = new Error("SECRET_INTERNAL");
    mount();
    await searchByName();
    fireEvent.click(screen.getByRole("button", { name: "Revisar Pikachu" }));
    fireEvent.click(screen.getByRole("button", { name: "Importar carta" }));
    await screen.findByRole("button", {
      name: "Verificar ou retomar importação",
    });
    expect(imports()).toHaveLength(1);
    expect(screen.queryByText(/SECRET_INTERNAL/)).toBeNull();
    importError = undefined;
    fireEvent.click(
      screen.getByRole("button", { name: "Verificar ou retomar importação" }),
    );
    await screen.findByText("Carta disponível na biblioteca.");
    expect(imports()).toHaveLength(2);
    expect(
      imports().map(([, request]) => JSON.parse(String(request?.body))),
    ).toEqual([{ externalId: "tcggo_123" }, { externalId: "tcggo_123" }]);
  });
  it("trata conflito sem criar outro anúncio ou importar automaticamente", async () => {
    importError = failure(409);
    mount();
    await searchByName();
    fireEvent.click(screen.getByRole("button", { name: "Revisar Pikachu" }));
    fireEvent.click(screen.getByRole("button", { name: "Importar carta" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("Já existe uma carta"),
    );
    expect(imports()).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Importar carta" })).toBeTruthy();
  });
  it("bloqueia duplicação e navegação enquanto importa", async () => {
    const pending = deferred<LocalCard>();
    const busy = vi.fn();
    mount({ onBusyChange: busy });
    await searchByName();
    fireEvent.click(screen.getByRole("button", { name: "Revisar Pikachu" }));
    vi.mocked(authorized).mockImplementation(((path, request) =>
      path === "/cards/import"
        ? pending.promise
        : server(path, request)) as typeof authorized);
    const button = screen.getByRole("button", { name: "Importar carta" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(imports()).toHaveLength(1);
    expect(
      (
        screen.getByRole("button", {
          name: "Cartas cadastradas",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Voltar às cartas",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(busy).toHaveBeenLastCalledWith(true);
    await act(async () => pending.resolve(clone(localCard)));
    await screen.findByText("Carta disponível na biblioteca.");
    expect(busy).toHaveBeenLastCalledWith(false);
  });
  it("aborta importação ao desmontar e libera apenas o painel antigo", async () => {
    const pending = deferred<LocalCard>();
    const busy = vi.fn();
    const mounted = mount({ onBusyChange: busy });
    await searchByName();
    fireEvent.click(screen.getByRole("button", { name: "Revisar Pikachu" }));
    vi.mocked(authorized).mockImplementation(((path, request) =>
      path === "/cards/import"
        ? pending.promise
        : server(path, request)) as typeof authorized);
    fireEvent.click(screen.getByRole("button", { name: "Importar carta" }));
    const signal = imports()[0]?.[1]?.signal;
    mounted.unmount();
    expect(signal?.aborted).toBe(true);
    expect(busy.mock.calls).toEqual([[true], [false]]);
    await act(async () => pending.resolve(clone(localCard)));
    expect(busy.mock.calls).toEqual([[true], [false]]);
  });
  it("descarta resultado importado após perda da sessão sem liberar outra sessão", async () => {
    let current = true;
    const busy = vi.fn();
    const pending = deferred<LocalCard>();
    const mounted = mount({
      isCurrentSession: () => current,
      onBusyChange: busy,
    });
    await searchByName();
    fireEvent.click(screen.getByRole("button", { name: "Revisar Pikachu" }));
    vi.mocked(authorized).mockImplementation(((path, request) =>
      path === "/cards/import"
        ? pending.promise
        : server(path, request)) as typeof authorized);
    fireEvent.click(screen.getByRole("button", { name: "Importar carta" }));
    current = false;
    await act(async () => pending.resolve(clone(localCard)));
    mounted.rerender(
      <AdminCardsArea isCurrentSession={() => current} onBusyChange={busy} />,
    );
    expect(screen.queryByText("Carta disponível na biblioteca.")).toBeNull();
    expect(busy.mock.calls).toEqual([[true]]);
  });
  it("descarta consulta externa atrasada depois de trocar para biblioteca local", async () => {
    const pending = deferred<ExternalCard[]>();
    mount();
    await externalView();
    vi.mocked(authorized).mockImplementation(((path, request) =>
      path.startsWith("/cards/search")
        ? pending.promise
        : server(path, request)) as typeof authorized);
    fireEvent.change(screen.getByLabelText("Nome (opcional)"), {
      target: { value: "Pikachu" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Pesquisar cartas" }));
    fireEvent.click(screen.getByRole("button", { name: "Cartas cadastradas" }));
    await localReady();
    await act(async () => pending.resolve(clone(remoteRows)));
    expect(
      screen.queryByRole("button", { name: "Revisar Pikachu" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Ver detalhes de Pikachu" }),
    ).toBeTruthy();
  });
  it("não exibe ou consulta dados quando a sessão já não é atual", async () => {
    mount({ isCurrentSession: () => false });
    await act(async () => {});
    expect(calls()).toHaveLength(0);
    expect(
      screen.queryByRole("region", { name: "Biblioteca de cartas" }),
    ).toBeNull();
  });
  it("recarrega biblioteca depois de importação ao trocar de aba", async () => {
    localRows = [];
    mount();
    await screen.findByText(/Nenhuma carta encontrada na biblioteca/);
    fireEvent.click(screen.getByRole("button", { name: "Pesquisar na API" }));
    fireEvent.change(screen.getByLabelText("Nome (opcional)"), {
      target: { value: "Pikachu" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Pesquisar cartas" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Revisar Pikachu" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Importar carta" }));
    await screen.findByText("Carta disponível na biblioteca.");
    fireEvent.click(screen.getByRole("button", { name: "Cartas cadastradas" }));
    await localReady();
    expect(calls().at(-1)?.[0]).toBe("/cards?page=1&limit=12");
  });
  it("trata acesso negado e remove resultados da tela", async () => {
    importError = failure(403);
    mount();
    await searchByName();
    fireEvent.click(screen.getByRole("button", { name: "Revisar Pikachu" }));
    fireEvent.click(screen.getByRole("button", { name: "Importar carta" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("Acesso restrito"),
    );
    expect(
      screen.queryByRole("region", { name: "Detalhes da carta" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Importar carta" })).toBeNull();
  });
  it("apresenta falha local com ação para atualizar", async () => {
    readError = failure(503);
    mount();
    await screen.findByRole("alert");
    readError = undefined;
    fireEvent.click(
      screen.getByRole("button", { name: "Atualizar biblioteca" }),
    );
    await localReady();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
