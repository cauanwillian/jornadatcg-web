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
import { AdminPanel } from "./AdminArea";
import { authorized } from "./session";
import type {
  AdminProduct,
  AdminProductsPage,
  ProductInput,
  ProductOptions,
} from "./admin-products";

vi.mock("./session", () => ({ authorized: vi.fn() }));
vi.mock("./StockEntryForm", () => ({
  StockEntryForm: (props: {
    productId: string;
    onBusyChange: (busy: boolean) => void;
    onRecorded: () => void;
  }) => (
    <section aria-label="Entrada simulada">
      <p>{props.productId}</p>
      <button onClick={() => props.onBusyChange(true)}>
        Iniciar entrada simulada
      </button>
      <button
        onClick={() => {
          props.onBusyChange(false);
          props.onRecorded();
        }}
      >
        Concluir entrada simulada
      </button>
    </section>
  ),
}));
vi.mock("./AdminProductEditor", () => ({
  ProductEditor: ({
    product,
    onSave,
    disabled,
    busy,
  }: {
    product?: AdminProduct;
    onSave: (input: ProductInput) => void;
    disabled?: boolean;
    busy?: boolean;
  }) => (
    <div>
      <button
        disabled={disabled || busy}
        onClick={() => onSave(inputFor(product))}
      >
        Salvar formulário sem alterações
      </button>
      <button
        disabled={disabled || busy}
        onClick={() =>
          onSave({
            ...inputFor(product),
            price: "12.50",
            availableQuantity: 99,
          })
        }
      >
        Salvar preço alterado
      </button>
    </div>
  ),
}));

const productId = "1dc068c0-d16d-4081-9d00-a73707709887";
const cardId = "2dc068c0-d16d-4081-9d00-a73707709887";
const categoryId = "3dc068c0-d16d-4081-9d00-a73707709887";
const conditionId = "4dc068c0-d16d-4081-9d00-a73707709887";
const languageId = "5dc068c0-d16d-4081-9d00-a73707709887";
const timestamp = "2026-10-22T20:00:00.000Z";
const currentSession = () => true;
const noop = () => {};

function product(availableQuantity = 4): AdminProduct {
  return {
    id: productId,
    price: "10.00",
    observation: null,
    active: true,
    featured: false,
    featuredOrder: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    card: {
      id: cardId,
      externalId: "local-test-card",
      name: "Pikachu de teste",
      number: "025",
      imageSmall: null,
      imageLarge: null,
      set: {
        id: "6dc068c0-d16d-4081-9d00-a73707709887",
        externalId: "local-test-set",
        name: "Coleção de teste",
      },
    },
    category: {
      id: categoryId,
      name: "Avulsas",
      slug: "avulsas",
      active: true,
    },
    condition: {
      id: conditionId,
      name: "Near Mint",
      code: "NM",
      active: true,
    },
    language: {
      id: languageId,
      name: "Português",
      code: "pt-BR",
      active: true,
    },
    inventory: {
      availableQuantity,
      reservedQuantity: 2,
      soldQuantity: 3,
      updatedAt: timestamp,
    },
  };
}

function inputFor(item = product()): ProductInput {
  return {
    cardId: item.card.id,
    categoryId: item.category.id,
    conditionId: item.condition.id,
    languageId: item.language.id,
    price: item.price,
    observation: item.observation,
    active: item.active,
    featured: item.featured,
    featuredOrder: item.featuredOrder,
    availableQuantity: item.inventory?.availableQuantity ?? 0,
  };
}

function options(): ProductOptions {
  return {
    categories: [
      { id: categoryId, name: "Avulsas", slug: "avulsas", description: null },
    ],
    conditions: [
      { id: conditionId, name: "Near Mint", code: "NM", description: null },
    ],
    languages: [{ id: languageId, name: "Português", code: "pt-BR" }],
  };
}

function failure(status: number, message = "Solicitação recusada.") {
  return Object.assign(new Error(message), { status });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function backend() {
  const state = {
    listProduct: product(1),
    current: product(4),
    total: 1,
    listError: null as Error | null,
    detailError: null as Error | null,
    patchError: null as Error | null,
    stockError: null as Error | null,
    createError: null as Error | null,
    detailWait: null as Promise<AdminProduct> | null,
    stockWait: null as Promise<AdminProduct> | null,
  };
  vi.mocked(authorized).mockImplementation(async (path, request) => {
    if (path === "/products/options") return options();
    if (path.startsWith("/products?")) {
      if (state.listError) throw state.listError;
      const query = new URLSearchParams(path.split("?")[1]);
      return {
        data: [state.listProduct],
        pagination: {
          page: Number(query.get("page")),
          limit: 12,
          total: state.total,
          totalPages: Math.ceil(state.total / 12),
        },
      } satisfies AdminProductsPage;
    }
    if (
      path === `/products/${productId}/inventory` &&
      request?.method === "PATCH"
    ) {
      if (state.stockError) throw state.stockError;
      if (state.stockWait) return state.stockWait;
      const body = JSON.parse(String(request.body)) as {
        availableQuantity: number;
      };
      state.current = {
        ...state.current,
        inventory: {
          ...state.current.inventory!,
          availableQuantity: body.availableQuantity,
        },
      };
      return state.current;
    }
    if (path === `/products/${productId}` && request?.method === "PATCH") {
      if (state.patchError) throw state.patchError;
      state.current = { ...state.current, ...JSON.parse(String(request.body)) };
      return state.current;
    }
    if (path === `/products/${productId}` && !request?.method) {
      if (state.detailError) throw state.detailError;
      return state.detailWait ?? state.current;
    }
    if (path === "/products" && request?.method === "POST") {
      if (state.createError) throw state.createError;
      return state.current;
    }
    throw new Error(
      `Rota de teste inesperada: ${request?.method ?? "GET"} ${path}`,
    );
  });
  return state;
}

function mutations(path?: string) {
  return vi
    .mocked(authorized)
    .mock.calls.filter(
      ([url, request]) => request?.method && (!path || url === path),
    );
}

function mount(props: Partial<Parameters<typeof AdminPanel>[0]> = {}) {
  return render(
    <AdminPanel
      userId="administrador-de-teste"
      isCurrentSession={currentSession}
      onBusyChange={noop}
      {...props}
    />,
  );
}

async function openProduct() {
  fireEvent.click(
    await screen.findByRole("button", { name: "Gerenciar Pikachu de teste" }),
  );
  await screen.findByRole("button", { name: "Editar anúncio" });
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});
afterEach(cleanup);

describe("AdminPanel", () => {
  it("abre a entrada do produto e atualiza o cadastro somente depois da confirmação", async () => {
    const server = backend();
    const changed = vi.fn(),
      busy = vi.fn();
    mount({ onChanged: changed, onBusyChange: busy });
    await openProduct();
    fireEvent.click(
      screen.getByRole("button", { name: "Registrar entrada de estoque" }),
    );
    await screen.findByLabelText("Entrada simulada");
    expect(screen.queryByLabelText("Novo estoque disponível")).toBeNull();
    expect(changed).not.toHaveBeenCalled();
    expect(mutations()).toEqual([]);
    fireEvent.click(
      screen.getByRole("button", { name: "Iniciar entrada simulada" }),
    );
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Voltar ao ajuste de estoque",
      }).disabled,
    ).toBe(true);
    server.current = product(9);
    fireEvent.click(
      screen.getByRole("button", { name: "Concluir entrada simulada" }),
    );
    await screen.findByText(
      "Entrada de estoque registrada. O saldo foi atualizado.",
    );
    await waitFor(() =>
      expect(
        screen.getByLabelText<HTMLInputElement>("Novo estoque disponível")
          .value,
      ).toBe("9"),
    );
    expect(screen.queryByLabelText("Entrada simulada")).toBeNull();
    expect(busy.mock.calls.map(([value]) => value)).toEqual([true, false]);
    expect(changed).toHaveBeenCalledOnce();
    expect(mutations()).toEqual([]);
  });
  it("permite voltar da entrada ao ajuste sem gravar", async () => {
    backend();
    mount();
    await openProduct();
    fireEvent.click(
      screen.getByRole("button", { name: "Registrar entrada de estoque" }),
    );
    await screen.findByLabelText("Entrada simulada");
    fireEvent.click(
      screen.getByRole("button", { name: "Voltar ao ajuste de estoque" }),
    );
    expect(screen.getByLabelText("Novo estoque disponível")).toBeTruthy();
    expect(mutations()).toEqual([]);
  });
  it("envia o motivo revisado no ajuste e limpa o campo após sucesso", async () => {
    backend();
    mount();
    await openProduct();
    fireEvent.change(screen.getByLabelText("Novo estoque disponível"), {
      target: { value: "8" },
    });
    fireEvent.change(screen.getByLabelText("Motivo do ajuste (opcional)"), {
      target: { value: "  Contagem conferida  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Revisar estoque" }));
    expect(screen.getByText("Motivo: Contagem conferida")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar estoque" }));
    await screen.findByText("Estoque disponível atualizado.");
    const body = JSON.parse(
      String(mutations(`/products/${productId}/inventory`)[0][1]?.body),
    );
    expect(body).toEqual({
      expectedAvailableQuantity: 4,
      availableQuantity: 8,
      reason: "Contagem conferida",
    });
    expect(
      screen.getByLabelText<HTMLInputElement>("Motivo do ajuste (opcional)")
        .value,
    ).toBe("");
  });
  it("bloqueia motivo inválido antes de apresentar confirmação", async () => {
    backend();
    mount();
    await openProduct();
    fireEvent.change(screen.getByLabelText("Novo estoque disponível"), {
      target: { value: "8" },
    });
    fireEvent.change(screen.getByLabelText("Motivo do ajuste (opcional)"), {
      target: { value: "ab" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Revisar estoque" }));
    expect(
      screen.queryByRole("button", { name: "Confirmar estoque" }),
    ).toBeNull();
    expect(mutations()).toEqual([]);
  });
  it("abre histórico do cadastro por ação explícita sem alterar estoque", async () => {
    backend();
    const onOpenHistory = vi.fn();
    mount({ onOpenHistory });
    await openProduct();
    expect(onOpenHistory).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Ver histórico de estoque" }),
    );
    expect(onOpenHistory).toHaveBeenCalledWith(productId);
    expect(mutations()).toEqual([]);
  });
  it("abre o produto escolhido no estoque por GET sem carregar a lista nem gravar", async () => {
    backend();
    mount({ initialProductId: productId });
    await screen.findByRole("button", { name: "Editar anúncio" });
    const calls = vi.mocked(authorized).mock.calls;
    expect(
      calls.filter(([path]) => path === `/products/${productId}`),
    ).toHaveLength(1);
    expect(calls.some(([path]) => path.startsWith("/products?"))).toBe(false);
    expect(mutations()).toEqual([]);
    expect(screen.getByLabelText("Estoque do produto").textContent).toContain(
      "4",
    );
  });
  it("retorna à lista depois de abrir o produto pelo estoque", async () => {
    backend();
    mount({ initialProductId: productId });
    await screen.findByRole("button", { name: "Editar anúncio" });
    fireEvent.click(
      screen.getByRole("button", { name: "Voltar aos produtos" }),
    );
    await screen.findByRole("button", { name: "Gerenciar Pikachu de teste" });
    expect(mutations()).toEqual([]);
  });
  it.each(["01", "not-a-uuid"])(
    "ignora destino inicial inválido %s",
    async (initialProductId) => {
      backend();
      mount({ initialProductId });
      await screen.findByRole("button", { name: "Gerenciar Pikachu de teste" });
      expect(
        vi
          .mocked(authorized)
          .mock.calls.some(
            ([path]) => path === `/products/${initialProductId}`,
          ),
      ).toBe(false);
      expect(mutations()).toEqual([]);
    },
  );
  it("descarta a consulta inicial de produto após desmontar o painel", async () => {
    const server = backend();
    const pending = deferred<AdminProduct>();
    server.detailWait = pending.promise;
    const busy = vi.fn();
    const view = mount({ initialProductId: productId, onBusyChange: busy });
    await waitFor(() =>
      expect(
        vi
          .mocked(authorized)
          .mock.calls.some(([path]) => path === `/products/${productId}`),
      ).toBe(true),
    );
    const signal = vi
      .mocked(authorized)
      .mock.calls.find(([path]) => path === `/products/${productId}`)![1]
      ?.signal;
    view.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      pending.resolve(product());
      await pending.promise;
    });
    expect(busy).not.toHaveBeenCalled();
    expect(mutations()).toEqual([]);
  });
  it("abre o catálogo administrativo sem modificar produtos ou consultar a API externa", async () => {
    backend();
    mount();
    await screen.findByRole("button", { name: "Gerenciar Pikachu de teste" });
    expect(vi.mocked(authorized).mock.calls.map(([path]) => path)).toEqual(
      expect.arrayContaining([
        "/products?page=1&limit=12",
        "/products/options",
      ]),
    );
    expect(mutations()).toEqual([]);
    expect(
      vi
        .mocked(authorized)
        .mock.calls.every(([path]) => path.startsWith("/products")),
    ).toBe(true);
  });

  it("consulta os dados atuais antes de oferecer edição e não usa o estoque da lista", async () => {
    backend();
    mount();
    await openProduct();
    expect(authorized).toHaveBeenCalledWith(
      `/products/${productId}`,
      expect.any(Object),
    );
    expect(mutations()).toEqual([]);
  });

  it("não envia um PATCH vazio ao salvar um anúncio sem alterações", async () => {
    backend();
    mount();
    await openProduct();
    fireEvent.click(screen.getByRole("button", { name: "Editar anúncio" }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Salvar formulário sem alterações",
      }),
    );
    await waitFor(() => expect(mutations()).toEqual([]));
  });

  it("envia somente os campos alterados do anúncio e exclui quantidade do PATCH", async () => {
    backend();
    mount();
    await openProduct();
    fireEvent.click(screen.getByRole("button", { name: "Editar anúncio" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Salvar preço alterado" }),
    );
    await waitFor(() =>
      expect(mutations(`/products/${productId}`)).toHaveLength(1),
    );
    expect(
      JSON.parse(String(mutations(`/products/${productId}`)[0][1]?.body)),
    ).toEqual({ price: "12.50" });
    expect(mutations(`/products/${productId}/inventory`)).toEqual([]);
  });

  it("aceita zerar o estoque somente após confirmação e compara com a quantidade recém-consultada", async () => {
    backend();
    mount();
    await openProduct();
    fireEvent.change(screen.getByLabelText("Novo estoque disponível"), {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Revisar estoque" }));
    expect(mutations()).toEqual([]);
    fireEvent.click(
      await screen.findByRole("button", { name: "Confirmar estoque" }),
    );
    await waitFor(() =>
      expect(mutations(`/products/${productId}/inventory`)).toHaveLength(1),
    );
    expect(
      JSON.parse(
        String(mutations(`/products/${productId}/inventory`)[0][1]?.body),
      ),
    ).toEqual({
      expectedAvailableQuantity: 4,
      availableQuantity: 0,
    });
    expect(mutations(`/products/${productId}`)).toEqual([]);
  });

  it("mantém o painel ocupado enquanto uma atualização de estoque aguarda resposta", async () => {
    const state = backend();
    const pending = deferred<AdminProduct>();
    const onBusyChange = vi.fn();
    state.stockWait = pending.promise;
    mount({ onBusyChange });
    await openProduct();
    fireEvent.change(screen.getByLabelText("Novo estoque disponível"), {
      target: { value: "7" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Revisar estoque" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Confirmar estoque" }),
    );
    await waitFor(() =>
      expect(mutations(`/products/${productId}/inventory`)).toHaveLength(1),
    );
    expect(onBusyChange).toHaveBeenLastCalledWith(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Voltar aos produtos",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    pending.resolve(product(7));
    await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
  });

  it("interrompe uma atualização sem resposta após 15 segundos e exige revisão manual", async () => {
    const state = backend();
    const onBusyChange = vi.fn();
    state.stockWait = new Promise<AdminProduct>(() => {});
    mount({ onBusyChange });
    await openProduct();
    vi.useFakeTimers();
    try {
      fireEvent.change(screen.getByLabelText("Novo estoque disponível"), {
        target: { value: "8" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Revisar estoque" }));
      fireEvent.click(
        screen.getByRole("button", { name: "Confirmar estoque" }),
      );
      const requests = mutations(`/products/${productId}/inventory`);
      expect(requests).toHaveLength(1);
      const signal = requests[0][1]?.signal;
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal?.aborted).toBe(false);
      expect(onBusyChange).toHaveBeenLastCalledWith(true);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(14_999);
      });
      expect(signal?.aborted).toBe(false);
      expect(onBusyChange).toHaveBeenLastCalledWith(true);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(signal?.aborted).toBe(true);
      expect(onBusyChange).toHaveBeenLastCalledWith(false);
      expect(screen.getByRole("alert").textContent).toMatch(
        /Consulte os dados atualizados/,
      );
      expect(
        (screen.getByLabelText("Novo estoque disponível") as HTMLInputElement)
          .disabled,
      ).toBe(true);
      expect(
        (
          screen.getByRole("button", {
            name: "Editar anúncio",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
      expect(mutations(`/products/${productId}/inventory`)).toHaveLength(1);
      expect(
        vi
          .mocked(authorized)
          .mock.calls.filter(
            ([path, request]) =>
              path === `/products/${productId}` && !request?.method,
          ),
      ).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }

    state.current = product(7);
    fireEvent.click(screen.getByRole("button", { name: "Atualizar produto" }));
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Novo estoque disponível") as HTMLInputElement)
          .disabled,
      ).toBe(false),
    );
    expect(
      (screen.getByLabelText("Novo estoque disponível") as HTMLInputElement)
        .value,
    ).toBe("7");
    expect(mutations(`/products/${productId}/inventory`)).toHaveLength(1);
  });

  it("não aplica uma resposta antiga quando a sessão muda durante a consulta do produto", async () => {
    const state = backend();
    const pending = deferred<AdminProduct>();
    state.detailWait = pending.promise;
    let sessionIsCurrent = true;
    mount({ isCurrentSession: () => sessionIsCurrent });
    fireEvent.click(
      await screen.findByRole("button", { name: "Gerenciar Pikachu de teste" }),
    );
    await waitFor(() =>
      expect(
        vi
          .mocked(authorized)
          .mock.calls.some(([path]) => path === `/products/${productId}`),
      ).toBe(true),
    );
    sessionIsCurrent = false;
    await act(async () => {
      pending.resolve(product());
    });
    expect(screen.queryByRole("button", { name: "Editar anúncio" })).toBeNull();
    expect(mutations()).toEqual([]);
  });

  it("aplica nome e status somente após filtrar e mantém os filtros na próxima página", async () => {
    const state = backend();
    state.total = 13;
    mount();
    await screen.findByRole("button", { name: "Gerenciar Pikachu de teste" });
    fireEvent.change(screen.getByLabelText("Nome da carta"), {
      target: { value: "  Pikachu  " },
    });
    fireEvent.change(screen.getByLabelText("Status do anúncio"), {
      target: { value: "false" },
    });
    expect(
      vi
        .mocked(authorized)
        .mock.calls.filter(([path]) => path.startsWith("/products?")),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Filtrar produtos" }));
    await waitFor(() =>
      expect(authorized).toHaveBeenCalledWith(
        "/products?page=1&limit=12&name=Pikachu&active=false",
        expect.any(Object),
      ),
    );
    await screen.findByRole("button", { name: "Gerenciar Pikachu de teste" });
    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    await waitFor(() =>
      expect(authorized).toHaveBeenCalledWith(
        "/products?page=2&limit=12&name=Pikachu&active=false",
        expect.any(Object),
      ),
    );
    expect(mutations()).toEqual([]);
  });

  it("bloqueia o estoque após conflito e só usa uma nova base depois de revisão manual", async () => {
    const state = backend();
    state.stockError = failure(409);
    mount();
    await openProduct();
    fireEvent.change(screen.getByLabelText("Novo estoque disponível"), {
      target: { value: "8" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Revisar estoque" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Confirmar estoque" }),
    );
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /alterados por outra operação/,
    );
    expect(
      (screen.getByLabelText("Novo estoque disponível") as HTMLInputElement)
        .disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Editar anúncio",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      vi
        .mocked(authorized)
        .mock.calls.filter(
          ([path, request]) =>
            path === `/products/${productId}` && !request?.method,
        ),
    ).toHaveLength(1);
    expect(mutations(`/products/${productId}/inventory`)).toHaveLength(1);

    state.stockError = null;
    state.current = product(2);
    fireEvent.click(screen.getByRole("button", { name: "Atualizar produto" }));
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Novo estoque disponível") as HTMLInputElement)
          .disabled,
      ).toBe(false),
    );
    expect(
      (screen.getByLabelText("Novo estoque disponível") as HTMLInputElement)
        .value,
    ).toBe("2");
    fireEvent.change(screen.getByLabelText("Novo estoque disponível"), {
      target: { value: "8" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Revisar estoque" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Confirmar estoque" }),
    );
    await waitFor(() =>
      expect(mutations(`/products/${productId}/inventory`)).toHaveLength(2),
    );
    expect(
      mutations(`/products/${productId}/inventory`).map(([, request]) =>
        JSON.parse(String(request?.body)),
      ),
    ).toEqual([
      { expectedAvailableQuantity: 4, availableQuantity: 8 },
      { expectedAvailableQuantity: 2, availableQuantity: 8 },
    ]);
  });

  it("exige consulta manual após uma falha de rede ao atualizar o anúncio", async () => {
    const state = backend();
    state.patchError = new TypeError("Resposta perdida.");
    mount();
    await openProduct();
    fireEvent.click(screen.getByRole("button", { name: "Editar anúncio" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Salvar preço alterado" }),
    );
    await screen.findByRole("alert");
    expect(mutations(`/products/${productId}`)).toHaveLength(1);
    expect(
      (
        screen.getByRole("button", {
          name: "Editar anúncio",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (screen.getByLabelText("Novo estoque disponível") as HTMLInputElement)
        .disabled,
    ).toBe(true);
    expect(
      vi
        .mocked(authorized)
        .mock.calls.filter(
          ([path, request]) =>
            path === `/products/${productId}` && !request?.method,
        ),
    ).toHaveLength(1);

    state.patchError = null;
    state.current = { ...product(), price: "12.50" };
    fireEvent.click(screen.getByRole("button", { name: "Atualizar produto" }));
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Editar anúncio",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    expect(mutations(`/products/${productId}`)).toHaveLength(1);
  });

  it("persiste a proteção de criação com resposta perdida e não repete o POST ao reabrir", async () => {
    const state = backend();
    state.createError = new TypeError("Resposta perdida após criar.");
    const first = mount();
    await screen.findByRole("button", { name: "Gerenciar Pikachu de teste" });
    fireEvent.click(screen.getByRole("button", { name: "Novo produto" }));
    const save = await screen.findByRole("button", {
      name: "Salvar formulário sem alterações",
    });
    fireEvent.click(save);
    fireEvent.click(save);
    await screen.findByText(/Não foi possível confirmar o cadastro/);
    expect(mutations("/products")).toHaveLength(1);
    expect(
      sessionStorage.getItem("jornada-admin-product:administrador-de-teste"),
    ).toBe(cardId);
    expect(
      (
        screen.getByRole("button", {
          name: "Novo produto",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    first.unmount();

    mount();
    await screen.findByRole("button", { name: "Gerenciar Pikachu de teste" });
    expect(
      (
        screen.getByRole("button", {
          name: "Novo produto",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      screen.queryByRole("button", { name: "Liberar novo cadastro" }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Conferir anúncios da carta" }),
    );
    await screen.findByRole("button", { name: "Liberar novo cadastro" });
    expect(authorized).toHaveBeenCalledWith(
      `/products?page=1&limit=12&cardId=${cardId}`,
      expect.any(Object),
    );
    expect(mutations("/products")).toHaveLength(1);
    expect(
      sessionStorage.getItem("jornada-admin-product:administrador-de-teste"),
    ).toBe(cardId);
    fireEvent.click(
      screen.getByRole("button", { name: "Liberar novo cadastro" }),
    );
    expect(
      sessionStorage.getItem("jornada-admin-product:administrador-de-teste"),
    ).toBeNull();
    expect(
      (
        screen.getByRole("button", {
          name: "Novo produto",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(mutations("/products")).toHaveLength(1);
  });

  it("retira a liberação de cadastro quando uma nova conferência da carta falha", async () => {
    const state = backend();
    sessionStorage.setItem(
      "jornada-admin-product:administrador-de-teste",
      cardId,
    );
    mount();
    await screen.findByRole("button", { name: "Gerenciar Pikachu de teste" });
    fireEvent.click(
      screen.getByRole("button", { name: "Conferir anúncios da carta" }),
    );
    await screen.findByRole("button", { name: "Liberar novo cadastro" });

    state.listError = failure(503);
    fireEvent.click(screen.getByRole("button", { name: "Atualizar produtos" }));
    await screen.findByRole("alert");
    expect(
      screen.queryByRole("button", { name: "Liberar novo cadastro" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Gerenciar Pikachu de teste" }),
    ).toBeNull();
    expect(
      (
        screen.getByRole("button", {
          name: "Novo produto",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      sessionStorage.getItem("jornada-admin-product:administrador-de-teste"),
    ).toBe(cardId);
    expect(mutations()).toEqual([]);
  });

  it("não libera cadastro com a conferência de outra pesquisa após mudar o filtro", async () => {
    backend();
    sessionStorage.setItem(
      "jornada-admin-product:administrador-de-teste",
      cardId,
    );
    mount();
    await screen.findByRole("button", { name: "Gerenciar Pikachu de teste" });
    fireEvent.click(
      screen.getByRole("button", { name: "Conferir anúncios da carta" }),
    );
    await screen.findByRole("button", { name: "Liberar novo cadastro" });

    fireEvent.change(screen.getByLabelText("Nome da carta"), {
      target: { value: "Charizard" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Filtrar produtos" }));
    await waitFor(() =>
      expect(authorized).toHaveBeenCalledWith(
        "/products?page=1&limit=12&name=Charizard",
        expect.any(Object),
      ),
    );
    await screen.findByRole("button", { name: "Gerenciar Pikachu de teste" });
    expect(
      screen.queryByRole("button", { name: "Liberar novo cadastro" }),
    ).toBeNull();
    expect(
      (
        screen.getByRole("button", {
          name: "Novo produto",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      sessionStorage.getItem("jornada-admin-product:administrador-de-teste"),
    ).toBe(cardId);
    expect(mutations()).toEqual([]);
  });

  it("não cria um produto se não conseguir guardar a proteção da tentativa", async () => {
    backend();
    mount();
    await screen.findByRole("button", { name: "Gerenciar Pikachu de teste" });
    fireEvent.click(screen.getByRole("button", { name: "Novo produto" }));
    const storage = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("Armazenamento bloqueado.");
      });
    try {
      fireEvent.click(
        await screen.findByRole("button", {
          name: "Salvar formulário sem alterações",
        }),
      );
      await screen.findByText(/Não foi possível proteger esta tentativa/);
      expect(mutations()).toEqual([]);
      fireEvent.click(
        screen.getByRole("button", {
          name: "Salvar formulário sem alterações",
        }),
      );
      expect(mutations()).toEqual([]);
    } finally {
      storage.mockRestore();
    }
  });

  it("remove os controles administrativos quando a listagem retorna acesso negado", async () => {
    const state = backend();
    state.listError = failure(403);
    mount();
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /Acesso restrito a administradores/,
    );
    expect(screen.queryByRole("button", { name: "Novo produto" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Gerenciar Pikachu de teste" }),
    ).toBeNull();
    expect(mutations()).toEqual([]);
  });

  it("interrompe a gestão caso a permissão seja revogada durante uma alteração", async () => {
    const state = backend();
    state.stockError = failure(403);
    mount();
    await openProduct();
    fireEvent.change(screen.getByLabelText("Novo estoque disponível"), {
      target: { value: "8" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Revisar estoque" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Confirmar estoque" }),
    );
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /Acesso restrito a administradores/,
    );
    expect(screen.queryByRole("button", { name: "Editar anúncio" })).toBeNull();
    expect(screen.queryByLabelText("Novo estoque disponível")).toBeNull();
    expect(mutations(`/products/${productId}/inventory`)).toHaveLength(1);
  });

  it("verifica a sessão novamente antes de confirmar uma alteração de estoque", async () => {
    backend();
    let sessionIsCurrent = true;
    mount({ isCurrentSession: () => sessionIsCurrent });
    await openProduct();
    fireEvent.change(screen.getByLabelText("Novo estoque disponível"), {
      target: { value: "8" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Revisar estoque" }));
    sessionIsCurrent = false;
    fireEvent.click(
      await screen.findByRole("button", { name: "Confirmar estoque" }),
    );
    expect(mutations()).toEqual([]);
  });

  it("cancela a consulta pendente ao voltar e ignora a resposta tardia", async () => {
    const state = backend();
    const pending = deferred<AdminProduct>();
    state.detailWait = pending.promise;
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "Gerenciar Pikachu de teste" }),
    );
    await waitFor(() =>
      expect(
        vi
          .mocked(authorized)
          .mock.calls.some(([path]) => path === `/products/${productId}`),
      ).toBe(true),
    );
    const request = vi
      .mocked(authorized)
      .mock.calls.find(([path]) => path === `/products/${productId}`)![1];
    expect(request?.signal?.aborted).toBe(false);
    fireEvent.click(
      screen.getByRole("button", { name: "Voltar aos produtos" }),
    );
    expect(request?.signal?.aborted).toBe(true);
    await act(async () => {
      pending.resolve(product());
    });
    await screen.findByRole("button", { name: "Gerenciar Pikachu de teste" });
    expect(screen.queryByRole("button", { name: "Editar anúncio" })).toBeNull();
    expect(mutations()).toEqual([]);
  });
});
