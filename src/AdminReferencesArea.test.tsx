// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminReferencesArea } from "./AdminReferencesArea";
import { useAdminReferences } from "./useAdminReferences";
import { authorized } from "./session";
import type { ProductOptions } from "./admin-products";
import type { ReferenceInput, ReferenceKind } from "./admin-references";

vi.mock("./session", () => ({ authorized: vi.fn() }));
const categoryId = "11111111-1111-4111-8111-111111111111";
const conditionId = "22222222-2222-4222-8222-222222222222";
const languageId = "33333333-3333-4333-8333-333333333333";
const newId = "44444444-4444-4444-8444-444444444444";
const current = () => true;
const noop = () => {};
const clone = <T,>(value: T): T => structuredClone(value);
let options: ProductOptions;
let readError: unknown;
let writeError: unknown;
let afterWriteError: unknown;
let wrote: boolean;
const error = (status: number) =>
  Object.assign(new Error("SECRET_INTERNAL_DO_NOT_RENDER"), { status });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function server(path: string, request: RequestInit = {}) {
  if ((request.method ?? "GET") === "GET") {
    if (readError) throw readError;
    if (wrote && afterWriteError) throw afterWriteError;
    if (path !== "/products/options") throw new Error("Unexpected GET");
    return clone(options);
  }
  if (writeError) throw writeError;
  const input = JSON.parse(String(request.body)) as ReferenceInput;
  wrote = true;
  if (path === "/products/categories") {
    const row = {
      id: newId,
      name: input.name,
      slug: input.slug!,
      description: input.description ?? null,
    };
    options.categories.push(row);
    return clone(row);
  }
  if (path === "/products/conditions") {
    const row = {
      id: newId,
      name: input.name,
      code: input.code!,
      description: input.description ?? null,
    };
    options.conditions.push(row);
    return clone(row);
  }
  if (path === "/products/languages") {
    const row = { id: newId, name: input.name, code: input.code! };
    options.languages.push(row);
    return clone(row);
  }
  throw new Error("Unexpected POST");
}
beforeEach(() => {
  vi.mocked(authorized).mockReset();
  options = {
    categories: [
      {
        id: categoryId,
        name: "Cartas avulsas",
        slug: "singles",
        description: "Cartas individuais",
      },
    ],
    conditions: [
      {
        id: conditionId,
        name: "Near Mint",
        code: "NM",
        description: "Conservação excelente",
      },
    ],
    languages: [{ id: languageId, name: "Português", code: "PT-BR" }],
  };
  readError = writeError = afterWriteError = undefined;
  wrote = false;
  vi.mocked(authorized).mockImplementation(server);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
async function view(
  props: Partial<Parameters<typeof AdminReferencesArea>[0]> = {},
) {
  const result = render(
    <AdminReferencesArea
      isCurrentSession={current}
      onBusyChange={noop}
      {...props}
    />,
  );
  await waitFor(() =>
    expect(screen.queryByText("Carregando cadastros…")).toBeNull(),
  );
  return result;
}
const kind = {
  category: {
    tab: "Categorias",
    action: "Cadastrar categoria",
    heading: "Nova categoria",
    identifier: "Identificador da categoria",
    save: "Salvar categoria",
    path: "/products/categories",
    name: "Acessórios",
    code: "acessorios",
  },
  condition: {
    tab: "Condições",
    action: "Cadastrar condição",
    heading: "Nova condição",
    identifier: "Código da condição",
    save: "Salvar condição",
    path: "/products/conditions",
    name: "Lightly Played",
    code: "LP",
  },
  language: {
    tab: "Idiomas",
    action: "Cadastrar idioma",
    heading: "Novo idioma",
    identifier: "Código do idioma",
    save: "Salvar idioma",
    path: "/products/languages",
    name: "Inglês",
    code: "EN",
  },
};
async function openForm(type: ReferenceKind = "category") {
  const fields = kind[type];
  fireEvent.click(screen.getByRole("button", { name: fields.tab }));
  fireEvent.click(screen.getByRole("button", { name: fields.action }));
  await screen.findByRole("form", { name: fields.heading });
  fireEvent.change(screen.getByLabelText("Nome"), {
    target: { value: fields.name },
  });
  fireEvent.change(screen.getByLabelText(fields.identifier), {
    target: { value: fields.code },
  });
  if (type !== "language")
    fireEvent.change(screen.getByLabelText("Descrição (opcional)"), {
      target: { value: "Descrição da opção" },
    });
}
function submit(type: ReferenceKind = "category") {
  fireEvent.click(screen.getByRole("button", { name: kind[type].save }));
}
const posts = () =>
  vi
    .mocked(authorized)
    .mock.calls.filter(([, request]) => request?.method === "POST");

describe("AdminReferencesArea", () => {
  it("reads the active options on mount and never writes automatically", async () => {
    await view();
    expect(
      screen.getByRole("heading", { name: "Cartas avulsas" }),
    ).toBeTruthy();
    expect(authorized).toHaveBeenCalledTimes(1);
    expect(authorized).toHaveBeenCalledWith(
      "/products/options",
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(posts()).toHaveLength(0);
  });
  it("switches kinds and filters locally, including names without accents", async () => {
    await view();
    fireEvent.click(screen.getByRole("button", { name: "Idiomas" }));
    expect(
      screen
        .getByRole("button", { name: "Idiomas" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.change(
      screen.getByLabelText("Filtrar por nome ou identificador"),
      { target: { value: "portugues" } },
    );
    expect(screen.getByRole("heading", { name: "Português" })).toBeTruthy();
    fireEvent.change(
      screen.getByLabelText("Filtrar por nome ou identificador"),
      { target: { value: "absent" } },
    );
    expect(
      screen.getByText("Nenhum cadastro corresponde ao filtro."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Condições" }));
    expect(screen.getByRole("heading", { name: "Near Mint" })).toBeTruthy();
    expect(
      (
        screen.getByLabelText(
          "Filtrar por nome ou identificador",
        ) as HTMLInputElement
      ).value,
    ).toBe("");
    expect(authorized).toHaveBeenCalledTimes(1);
  });
  it.each(["category", "condition", "language"] as const)(
    "creates %s only on explicit submit and refreshes canonical data",
    async (type) => {
      const changed = vi.fn();
      await view({ onChanged: changed });
      await openForm(type);
      expect(posts()).toHaveLength(0);
      submit(type);
      await screen.findByRole("heading", { name: kind[type].name });
      expect(posts()).toHaveLength(1);
      const [path, request] = posts()[0];
      expect(path).toBe(kind[type].path);
      expect(JSON.parse(String(request!.body))).toEqual({
        name: kind[type].name,
        ...(type === "category"
          ? { slug: kind[type].code }
          : { code: kind[type].code }),
        ...(type === "language" ? {} : { description: "Descrição da opção" }),
      });
      expect(
        vi
          .mocked(authorized)
          .mock.calls.filter(([path]) => path === "/products/options"),
      ).toHaveLength(2);
      expect(changed).toHaveBeenCalledTimes(1);
    },
  );
  it("keeps navigation locked until the canonical read settles and rejects duplicate submits", async () => {
    const refreshed = deferred<ProductOptions>();
    const busy = vi.fn();
    const changed = vi.fn();
    await view({ onBusyChange: busy, onChanged: changed });
    await openForm();
    vi.mocked(authorized).mockImplementation(async (path, request) =>
      wrote && (request?.method ?? "GET") === "GET"
        ? refreshed.promise
        : server(path, request),
    );
    const form = screen.getByRole("form", { name: "Nova categoria" });
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(posts()).toHaveLength(1));
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "Cadastrar categoria",
        }),
      ).toBeTruthy(),
    );
    expect(busy.mock.calls).toEqual([[true]]);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(
      (
        screen.getByRole("button", {
          name: "Cadastrar categoria",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Idiomas",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await act(async () => refreshed.resolve(clone(options)));
    expect(busy.mock.calls).toEqual([[true], [false]]);
    expect(changed).toHaveBeenCalledTimes(1);
  });
  it("keeps the form editable after a definitive 400 without rereading or retrying", async () => {
    const changed = vi.fn();
    await view({ onChanged: changed });
    await openForm();
    writeError = error(400);
    submit();
    await screen.findByRole("alert");
    expect(screen.getByRole("form", { name: "Nova categoria" })).toBeTruthy();
    expect((screen.getByLabelText("Nome") as HTMLInputElement).value).toBe(
      "Acessórios",
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Salvar categoria",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(screen.getByRole("alert").textContent).not.toContain("SECRET");
    expect(posts()).toHaveLength(1);
    expect(authorized).toHaveBeenCalledTimes(2);
    expect(changed).not.toHaveBeenCalled();
    writeError = undefined;
    submit();
    await screen.findByRole("heading", { name: "Acessórios" });
  });
  it("refreshes once after 409, explains possible inactive conflicts, and preserves fields", async () => {
    const changed = vi.fn();
    await view({ onChanged: changed });
    await openForm();
    writeError = error(409);
    submit();
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("inativo"),
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "nome da categoria",
    );
    expect((screen.getByLabelText("Nome") as HTMLInputElement).value).toBe(
      "Acessórios",
    );
    expect(posts()).toHaveLength(1);
    expect(
      vi
        .mocked(authorized)
        .mock.calls.filter(([path]) => path === "/products/options"),
    ).toHaveLength(2);
    expect(screen.queryByText(/SECRET/)).toBeNull();
    expect(changed).not.toHaveBeenCalled();
  });
  it("blocks after a failed 409 reread until the user refreshes", async () => {
    await view();
    await openForm();
    writeError = error(409);
    readError = new TypeError("private");
    submit();
    await screen.findByRole("button", {
      name: "Atualizar cadastros",
    });
    expect(
      (
        screen.getByRole("button", {
          name: "Cadastrar categoria",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    readError = undefined;
    fireEvent.click(
      screen.getByRole("button", { name: "Atualizar cadastros" }),
    );
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Cadastrar categoria",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    expect(posts()).toHaveLength(1);
  });
  it.each([undefined, 503, 408])(
    "requires manual read and explicit review after uncertain POST status %s",
    async (code) => {
      const changed = vi.fn();
      await view({ onChanged: changed });
      await openForm();
      writeError = code === undefined ? new TypeError("PRIVATE") : error(code);
      submit();
      await screen.findByLabelText("Conferir cadastro anterior");
      expect(
        (
          screen.getByRole("button", {
            name: "Cadastrar categoria",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
      expect(
        screen.queryByRole("button", { name: "Liberar novo cadastro" }),
      ).toBeNull();
      fireEvent.click(
        screen.getByRole("button", {
          name: "Atualizar cadastros",
        }),
      );
      const release = await screen.findByRole("button", {
        name: "Liberar novo cadastro",
      });
      expect((release as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(
        screen.getByRole("checkbox", {
          name: "Conferi os cadastros e a opção que desejo criar ainda não existe",
        }),
      );
      fireEvent.click(release);
      expect(
        (
          screen.getByRole("button", {
            name: "Cadastrar categoria",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false);
      expect(posts()).toHaveLength(1);
      expect(screen.queryByText(/PRIVATE|SECRET/)).toBeNull();
      expect(changed).not.toHaveBeenCalled();
    },
  );
  it("does not treat a successful POST followed by failed read as an uncertain creation", async () => {
    const changed = vi.fn();
    await view({ onChanged: changed });
    await openForm();
    afterWriteError = error(503);
    submit();
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("recebido"),
    );
    expect(screen.queryByLabelText("Conferir cadastro anterior")).toBeNull();
    expect(changed).toHaveBeenCalledTimes(1);
    afterWriteError = undefined;
    fireEvent.click(
      screen.getByRole("button", { name: "Atualizar cadastros" }),
    );
    await screen.findByRole("heading", { name: "Acessórios" });
    expect(posts()).toHaveLength(1);
    expect(changed).toHaveBeenCalledTimes(1);
  });
  it.each([401, 403])(
    "clears loaded options and closes the form after auth failure %s",
    async (code) => {
      await view();
      await openForm();
      writeError = error(code);
      submit();
      await waitFor(() =>
        expect(screen.getByRole("alert").textContent).toContain(
          "Acesso restrito",
        ),
      );
      expect(screen.queryByRole("form")).toBeNull();
      expect(
        screen.queryByRole("heading", { name: "Cartas avulsas" }),
      ).toBeNull();
      expect(
        screen.queryByRole("button", {
          name: "Cadastrar categoria",
        }),
      ).toBeNull();
    },
  );
  it("offers safe retry when the initial read fails and supports an empty list", async () => {
    readError = error(503);
    await view();
    expect(screen.getByRole("alert").textContent).not.toContain("SECRET");
    readError = undefined;
    options.categories = [];
    fireEvent.click(
      screen.getByRole("button", { name: "Atualizar cadastros" }),
    );
    await screen.findByText(
      "Nenhum cadastro ativo nesta lista. Cadastre uma opção para usá-la nos anúncios.",
    );
    expect(posts()).toHaveLength(0);
  });
  it("paginates locally, resets on filtering and clamps after a smaller refresh", async () => {
    options.categories = Array.from({ length: 25 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      name: `Categoria ${String(index + 1).padStart(2, "0")}`,
      slug: `categoria-${index + 1}`,
      description: null,
    }));
    await view();
    expect(screen.getAllByRole("listitem")).toHaveLength(12);
    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    expect(screen.getByText("Página 3 de 3")).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(authorized).toHaveBeenCalledTimes(1);
    fireEvent.change(
      screen.getByLabelText("Filtrar por nome ou identificador"),
      { target: { value: "Categoria 02" } },
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    fireEvent.change(
      screen.getByLabelText("Filtrar por nome ou identificador"),
      { target: { value: "" } },
    );
    options.categories = options.categories.slice(0, 1);
    fireEvent.click(
      screen.getByRole("button", { name: "Atualizar cadastros" }),
    );
    await waitFor(() =>
      expect(screen.getAllByRole("listitem")).toHaveLength(1),
    );
    expect(screen.queryByText("Página 3 de 1")).toBeNull();
    expect(posts()).toHaveLength(0);
  });
  it("discards stale refresh responses and aborts old reads", async () => {
    const old = deferred<ProductOptions>();
    const fresh = deferred<ProductOptions>();
    const { result } = renderHook(() => useAdminReferences(current, noop));
    await waitFor(() => expect(result.current.loading).toBe(false));
    vi.mocked(authorized)
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(fresh.promise);
    // Two requests can arrive in the same event before the loading state renders.
    act(() => {
      result.current.refresh();
      result.current.refresh();
    });
    expect(authorized).toHaveBeenCalledTimes(3);
    const firstSignal = vi.mocked(authorized).mock.calls[1][1]!.signal!;
    const latestSignal = vi.mocked(authorized).mock.calls[2][1]!.signal!;
    expect(firstSignal.aborted).toBe(true);
    expect(latestSignal.aborted).toBe(false);
    await act(async () => fresh.resolve(clone(options)));
    await act(async () => old.resolve({ ...clone(options), categories: [] }));
    expect(result.current.rows.map((row) => row.name)).toEqual([
      "Cartas avulsas",
    ]);
    expect(result.current.error).toBe("");
    expect(posts()).toHaveLength(0);
  });
  it("aborts a pending read and ignores its response after unmount", async () => {
    const late = deferred<ProductOptions>();
    vi.mocked(authorized).mockReturnValue(late.promise);
    const rendered = render(
      <AdminReferencesArea isCurrentSession={current} onBusyChange={noop} />,
    );
    await waitFor(() => expect(authorized).toHaveBeenCalledTimes(1));
    const signal = vi.mocked(authorized).mock.calls[0][1]!.signal!;
    rendered.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => late.resolve(clone(options)));
    expect(posts()).toHaveLength(0);
  });
  it("hides data and ignores a write when the session becomes obsolete", async () => {
    let valid = true;
    const changed = vi.fn();
    const late = deferred<unknown>();
    const rendered = await view({
      isCurrentSession: () => valid,
      onChanged: changed,
    });
    await openForm();
    vi.mocked(authorized).mockReturnValue(late.promise);
    submit();
    valid = false;
    rendered.rerender(
      <AdminReferencesArea
        isCurrentSession={() => valid}
        onBusyChange={noop}
        onChanged={changed}
      />,
    );
    await act(async () =>
      late.resolve({
        id: newId,
        name: "Acessórios",
        slug: "acessorios",
        description: "Descrição da opção",
      }),
    );
    expect(screen.queryByLabelText("Cadastros da loja")).toBeNull();
    expect(changed).not.toHaveBeenCalled();
  });
  it("aborts a pending write on unmount and releases its parent lock once", async () => {
    const busy = vi.fn();
    const changed = vi.fn();
    const late = deferred<unknown>();
    const rendered = await view({ onBusyChange: busy, onChanged: changed });
    await openForm();
    vi.mocked(authorized).mockReturnValue(late.promise);
    submit();
    const signal = posts()[0][1]!.signal!;
    rendered.unmount();
    expect(signal.aborted).toBe(true);
    expect(busy.mock.calls).toEqual([[true], [false]]);
    await act(async () =>
      late.resolve({
        id: newId,
        name: "Acessórios",
        slug: "acessorios",
        description: "Descrição da opção",
      }),
    );
    expect(busy.mock.calls).toEqual([[true], [false]]);
    expect(changed).not.toHaveBeenCalled();
    expect(posts()).toHaveLength(1);
    expect(
      vi
        .mocked(authorized)
        .mock.calls.filter(([path]) => path === "/products/options"),
    ).toHaveLength(1);
  });
  it("times out a never-settling POST without repeating it and releases the parent lock", async () => {
    const busy = vi.fn();
    await view({ onBusyChange: busy });
    await openForm();
    vi.useFakeTimers();
    vi.mocked(authorized).mockReturnValue(new Promise(() => {}));
    submit();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15001);
    });
    expect(screen.getByLabelText("Conferir cadastro anterior")).toBeTruthy();
    expect(busy.mock.calls).toEqual([[true], [false]]);
    expect(posts()).toHaveLength(1);
    expect(
      (
        screen.getByRole("button", {
          name: "Cadastrar categoria",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});
