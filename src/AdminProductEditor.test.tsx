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
import { ProductEditor } from "./AdminProductEditor";
import type { AdminProduct, ProductOptions } from "./admin-products";
import { authorized } from "./session";

vi.mock("./session", () => ({ authorized: vi.fn() }));

const ids = {
  card: "10000000-0000-4000-8000-000000000001",
  category: "10000000-0000-4000-8000-000000000002",
  condition: "10000000-0000-4000-8000-000000000003",
  language: "10000000-0000-4000-8000-000000000004",
  product: "10000000-0000-4000-8000-000000000005",
  anotherCard: "10000000-0000-4000-8000-000000000006",
};
const card = {
  id: ids.card,
  name: "Pikachu",
  number: "025",
  set: { name: "Coleção de teste" },
};
const anotherCard = {
  ...card,
  id: ids.anotherCard,
  name: "Charizard",
  number: "004",
};
const options: ProductOptions = {
  categories: [
    {
      id: ids.category,
      name: "Cartas avulsas",
      slug: "avulsas",
      description: null,
    },
  ],
  conditions: [
    { id: ids.condition, name: "Near Mint", code: "NM", description: null },
  ],
  languages: [{ id: ids.language, name: "Português", code: "PT" }],
};
const product: AdminProduct = {
  id: ids.product,
  price: "12.50",
  observation: "Produto de teste",
  active: true,
  featured: false,
  featuredOrder: 0,
  createdAt: "2026-10-22T00:00:00.000Z",
  updatedAt: "2026-10-22T00:00:00.000Z",
  card: {
    ...card,
    externalId: "local-test",
    imageSmall: null,
    imageLarge: null,
    set: {
      id: ids.category,
      name: "Coleção de teste",
      externalId: "local-set",
    },
  },
  category: { ...options.categories[0], active: true },
  condition: { ...options.conditions[0], active: true },
  language: { ...options.languages[0], active: true },
  inventory: {
    availableQuantity: 8,
    reservedQuantity: 2,
    soldQuantity: 3,
    updatedAt: "2026-10-22T00:00:00.000Z",
  },
};
function page(data = [card], current = 1, totalPages = 1) {
  return {
    data,
    pagination: {
      page: current,
      limit: 12,
      total: totalPages * 12,
      totalPages,
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup(overrides: Partial<Parameters<typeof ProductEditor>[0]> = {}) {
  const props = {
    options,
    busy: false,
    onSave: vi.fn().mockResolvedValue(true),
    onCancel: vi.fn(),
    isCurrentSession: () => true,
    ...overrides,
  };
  return { ...render(<ProductEditor {...props} />), props };
}
async function ready() {
  await screen.findByRole("radio", { name: /Pikachu/ });
  await waitFor(() =>
    expect(screen.queryByText("Consultando cartas cadastradas…")).toBeNull(),
  );
}
function fields() {
  fireEvent.change(screen.getByLabelText("Categoria"), {
    target: { value: ids.category },
  });
  fireEvent.change(screen.getByLabelText("Condição"), {
    target: { value: ids.condition },
  });
  fireEvent.change(screen.getByLabelText("Idioma"), {
    target: { value: ids.language },
  });
  fireEvent.change(screen.getByLabelText("Preço (R$)"), {
    target: { value: " 12,50 " },
  });
  fireEvent.change(screen.getByLabelText("Estoque inicial"), {
    target: { value: "8" },
  });
}
function submit(name = "Cadastrar produto") {
  fireEvent.submit(screen.getByRole("button", { name }).closest("form")!);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(authorized).mockResolvedValue(page());
});
afterEach(cleanup);

describe("Administrative product editor", () => {
  it("loads only local cards and does not choose or save one automatically", async () => {
    const read = deferred<ReturnType<typeof page>>();
    vi.mocked(authorized).mockReturnValue(read.promise as never);
    const { props } = setup();
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Cadastrar produto",
      }).disabled,
    ).toBe(true);
    await waitFor(() => expect(authorized).toHaveBeenCalledOnce());
    expect(authorized).toHaveBeenCalledWith("/cards?page=1&limit=12", {
      signal: expect.any(AbortSignal),
    });
    await act(async () => {
      read.resolve(page());
    });
    expect(
      screen.getByRole<HTMLInputElement>("radio", { name: /Pikachu/ }).checked,
    ).toBe(false);
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it("submits a normalized product only after an explicit card choice and valid form", async () => {
    const { props } = setup();
    await ready();
    fields();
    fireEvent.click(screen.getByRole("radio", { name: /Pikachu/ }));
    fireEvent.change(screen.getByLabelText("Observação (opcional)"), {
      target: { value: "  Carta de teste  " },
    });
    fireEvent.click(screen.getByLabelText("Exibir nos destaques"));
    fireEvent.change(screen.getByLabelText("Ordem do destaque"), {
      target: { value: "2" },
    });
    submit();
    await waitFor(() => expect(props.onSave).toHaveBeenCalledOnce());
    expect(props.onSave).toHaveBeenCalledWith({
      cardId: ids.card,
      categoryId: ids.category,
      conditionId: ids.condition,
      languageId: ids.language,
      price: "12.50",
      availableQuantity: 8,
      observation: "Carta de teste",
      active: true,
      featured: true,
      featuredOrder: 2,
    });
    expect(authorized).toHaveBeenCalledOnce();
  });

  it("requires choosing a card instead of implicitly using the first result", async () => {
    const { props } = setup();
    await ready();
    fields();
    submit();
    expect(props.onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("radio").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain(
      "Confira os campos",
    );
  });

  it.each([
    ["Preço (R$)", "-1"],
    ["Preço (R$)", "1,234"],
    ["Estoque inicial", "1.5"],
    ["Estoque inicial", "-1"],
  ])(
    "rejects invalid %s value %s with an accessible field error",
    async (label, value) => {
      const { props } = setup();
      await ready();
      fields();
      fireEvent.click(screen.getByRole("radio"));
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
      submit();
      expect(props.onSave).not.toHaveBeenCalled();
      const field = screen.getByLabelText(label);
      expect(field.getAttribute("aria-invalid")).toBe("true");
      expect(
        document.getElementById(field.getAttribute("aria-describedby")!)
          ?.textContent,
      ).toBeTruthy();
    },
  );

  it("keeps the linked card immutable and omits an editable stock field when editing", async () => {
    const { props } = setup({ product });
    expect(
      screen.getByText(/A carta vinculada ao produto não pode ser alterada/),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Buscar carta pelo nome")).toBeNull();
    expect(screen.queryByLabelText("Estoque inicial")).toBeNull();
    expect(screen.getByText(/Estoque disponível: 8/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Preço (R$)"), {
      target: { value: "15,90" },
    });
    fireEvent.click(screen.getByLabelText("Produto ativo"));
    submit("Salvar alterações");
    await waitFor(() => expect(props.onSave).toHaveBeenCalledOnce());
    expect(props.onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        cardId: ids.card,
        price: "15.90",
        active: false,
      }),
    );
    expect(authorized).not.toHaveBeenCalled();
  });

  it("preserves existing inactive references absent from active options", async () => {
    const { props } = setup({
      product: { ...product, category: { ...product.category, active: false } },
      options: { ...options, categories: [] },
    });
    expect(screen.getByLabelText<HTMLSelectElement>("Categoria").value).toBe(
      ids.category,
    );
    expect(
      screen.getByRole("option", { name: "Cartas avulsas (inativo)" }),
    ).toBeTruthy();
    submit("Salvar alterações");
    await waitFor(() => expect(props.onSave).toHaveBeenCalledOnce());
    expect(props.onSave).toHaveBeenCalledWith(
      expect.objectContaining({ categoryId: ids.category }),
    );
  });

  it("distinguishes missing inventory from an actual zero quantity", () => {
    const { props, rerender } = setup({
      product: { ...product, inventory: null },
    });
    expect(screen.getByText(/Estoque disponível: Não cadastrado/)).toBeTruthy();
    expect(screen.queryByText(/Estoque disponível: 0/)).toBeNull();
    rerender(
      <ProductEditor
        {...props}
        product={{
          ...product,
          inventory: { ...product.inventory!, availableQuantity: 0 },
        }}
      />,
    );
    expect(screen.getByText(/Estoque disponível: 0/)).toBeTruthy();
    expect(screen.queryByText(/Estoque disponível: Não cadastrado/)).toBeNull();
  });

  it("searches explicitly by name and paginates using the applied filter", async () => {
    vi.mocked(authorized)
      .mockResolvedValueOnce(page())
      .mockResolvedValueOnce(page([card], 1, 2))
      .mockResolvedValueOnce(page([anotherCard], 2, 2));
    setup();
    await ready();
    fireEvent.change(screen.getByLabelText("Buscar carta pelo nome"), {
      target: { value: "  Pika chu  " },
    });
    expect(authorized).toHaveBeenCalledOnce();
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Buscar cartas cadastradas" })
        .closest("form")!,
    );
    await screen.findByText("Página 1 de 2");
    expect(authorized).toHaveBeenLastCalledWith(
      "/cards?page=1&limit=12&name=Pika+chu",
      { signal: expect.any(AbortSignal) },
    );
    fireEvent.change(screen.getByLabelText("Buscar carta pelo nome"), {
      target: { value: "unsubmitted text" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    await screen.findByText("Página 2 de 2");
    expect(authorized).toHaveBeenLastCalledWith(
      "/cards?page=2&limit=12&name=Pika+chu",
      { signal: expect.any(AbortSignal) },
    );
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Próxima" })
        .disabled,
    ).toBe(true);
  });

  it("preserves the chosen card after moving to another page", async () => {
    vi.mocked(authorized)
      .mockResolvedValueOnce(page([card], 1, 2))
      .mockResolvedValueOnce(page([anotherCard], 2, 2));
    const { props } = setup();
    await ready();
    fireEvent.click(screen.getByRole("radio", { name: /Pikachu/ }));
    fields();
    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    await screen.findByRole("radio", { name: /Charizard/ });
    expect(screen.getByText(/Carta selecionada:/).textContent).toContain(
      "Pikachu",
    );
    submit();
    await waitFor(() => expect(props.onSave).toHaveBeenCalledOnce());
    expect(props.onSave).toHaveBeenCalledWith(
      expect.objectContaining({ cardId: ids.card }),
    );
  });

  it("removes the name parameter for an empty search and displays empty results", async () => {
    vi.mocked(authorized)
      .mockResolvedValueOnce(page())
      .mockResolvedValueOnce(page([]));
    setup();
    await ready();
    fireEvent.change(screen.getByLabelText("Buscar carta pelo nome"), {
      target: { value: "   " },
    });
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Buscar cartas cadastradas" })
        .closest("form")!,
    );
    await screen.findByText("Nenhuma carta cadastrada encontrada.");
    expect(authorized).toHaveBeenLastCalledWith("/cards?page=1&limit=12", {
      signal: expect.any(AbortSignal),
    });
  });

  it("blocks duplicate saves, form controls, and cancellation while saving", async () => {
    const save = deferred<boolean>();
    const { props } = setup({ product, onSave: vi.fn(() => save.promise) });
    submit("Salvar alterações");
    expect(
      screen.getByLabelText("Preço (R$)").closest("fieldset")!.disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar edição" }));
    submit("Salvando…");
    expect(props.onSave).toHaveBeenCalledOnce();
    expect(props.onCancel).not.toHaveBeenCalled();
    await act(async () => {
      save.resolve(false);
    });
    expect(
      screen.getByRole("button", { name: "Salvar alterações" }),
    ).toBeTruthy();
  });

  it("blocks controls while the parent is busy and permits explicit cancellation afterward", () => {
    const { props, rerender } = setup({ product, busy: true });
    expect(
      screen.getByLabelText("Preço (R$)").closest("fieldset")!.disabled,
    ).toBe(true);
    submit("Salvar alterações");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar edição" }));
    expect(props.onSave).not.toHaveBeenCalled();
    expect(props.onCancel).not.toHaveBeenCalled();
    rerender(<ProductEditor {...props} busy={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar edição" }));
    expect(props.onCancel).toHaveBeenCalledOnce();
  });

  it("aborts an unfinished card read when unmounted", async () => {
    const read = deferred<ReturnType<typeof page>>();
    vi.mocked(authorized).mockReturnValue(read.promise as never);
    const { unmount, props } = setup();
    await waitFor(() => expect(authorized).toHaveBeenCalledOnce());
    const signal = vi.mocked(authorized).mock.calls[0][1]!.signal!;
    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => {
      read.resolve(page());
    });
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it("discards late reads and prevents saves after the session changes", async () => {
    let current = true;
    const read = deferred<ReturnType<typeof page>>();
    vi.mocked(authorized).mockReturnValue(read.promise as never);
    const { props } = setup({ isCurrentSession: () => current });
    await waitFor(() => expect(authorized).toHaveBeenCalledOnce());
    current = false;
    await act(async () => {
      read.resolve(page());
    });
    expect(screen.queryByRole("radio")).toBeNull();
    submit();
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it("shows card lookup failure without enabling an implicit save or external request", async () => {
    vi.mocked(authorized).mockRejectedValue(new Error("Serviço indisponível."));
    const { props } = setup();
    await screen.findByRole("alert");
    expect(screen.getByText("Serviço indisponível.")).toBeTruthy();
    submit();
    expect(props.onSave).not.toHaveBeenCalled();
    expect(authorized).toHaveBeenCalledOnce();
  });
});
