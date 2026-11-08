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
import { BannerPanel } from "./AdminBannersArea";
import { authorized, authorizedBlob } from "./session";

interface BannerFixture {
  id: string;
  title: string;
  link: string | null;
  active: boolean;
  sortOrder: number;
  imageUrl: string;
  createdAt: string;
  updatedAt: string;
}
interface InputFixture {
  title: string;
  link: string | null;
  active: boolean;
  sortOrder: number;
}

vi.mock("./session", () => ({
  authorized: vi.fn(),
  authorizedBlob: vi.fn(),
}));
vi.mock("./AdminBannerEditor", () => ({
  BannerEditor: ({
    banner,
    onSave,
    onCancel,
    disabled,
    busy,
  }: {
    banner?: BannerFixture;
    onSave: (input: InputFixture, image: File | null) => Promise<boolean>;
    onCancel: () => void;
    disabled?: boolean;
    busy?: boolean;
  }) => (
    <div>
      <p>Editor de {banner?.title ?? "novo banner"}</p>
      <button
        disabled={disabled || busy}
        onClick={() => void onSave(inputFor(banner), banner ? null : image())}
      >
        Salvar formulário sem alterações
      </button>
      <button disabled={disabled || busy} onClick={onCancel}>Voltar aos banners</button>
      <button
        disabled={disabled || busy}
        onClick={() =>
          void onSave({ ...inputFor(banner), title: "Banner atualizado" }, null)
        }
      >
        Salvar título alterado
      </button>
      <button
        disabled={disabled || busy}
        onClick={() =>
          void onSave({ ...inputFor(banner), active: !inputFor(banner).active }, null)
        }
      >
        Salvar status alterado
      </button>
    </div>
  ),
  BannerImagePicker: ({
    disabled,
    onChange,
    label = "Imagem do banner",
  }: {
    disabled?: boolean;
    onChange: (file: File | null) => void;
    label?: string;
  }) => (
    <label>
      {label}
      <input
        type="file"
        disabled={disabled}
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
      />
    </label>
  ),
}));

const bannerId = "1dc068c0-d16d-4081-9d00-a73707709887";
const timestamp = "2026-10-22T20:00:00.000Z";
const currentSession = () => true;
const noop = () => {};
const image = () => new File(["conteúdo fictício"], "banner.png", { type: "image/png" });

function banner(changes: Partial<BannerFixture> = {}): BannerFixture {
  return {
    id: bannerId,
    title: "Banner de teste",
    link: "/catalogo",
    active: true,
    sortOrder: 2,
    imageUrl: `/banners/${bannerId}/image?v=1792699200000`,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...changes,
  };
}
function inputFor(item = banner()): InputFixture {
  return {
    title: item.title,
    link: item.link,
    active: item.active,
    sortOrder: item.sortOrder,
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
    rows: [banner()],
    listError: null as Error | null,
    mutationError: null as Error | null,
    listWait: null as Promise<{ data: BannerFixture[] }> | null,
    mutationWait: null as Promise<BannerFixture> | null,
    blobWait: null as Promise<Blob> | null,
    blobError: null as Error | null,
  };
  vi.mocked(authorized).mockImplementation(async (path, request) => {
    if (path === "/admin/banners" && !request?.method) {
      if (state.listError) throw state.listError;
      return state.listWait ?? { data: [...state.rows] };
    }
    if (
      (path === "/admin/banners" && request?.method === "POST") ||
      (path === `/admin/banners/${bannerId}` && request?.method === "PATCH") ||
      (path === `/admin/banners/${bannerId}/image` && request?.method === "POST")
    ) {
      if (state.mutationError) throw state.mutationError;
      if (state.mutationWait) return state.mutationWait;
      const fields = request?.body instanceof FormData
        ? Object.fromEntries(request.body.entries())
        : JSON.parse(String(request?.body));
      const updated = banner({
        ...state.rows[0],
        ...(typeof fields.title === "string" ? { title: fields.title } : {}),
        ...(fields.active !== undefined
          ? { active: fields.active === true || fields.active === "true" }
          : {}),
      });
      state.rows = [updated];
      return updated;
    }
    throw new Error(`Rota inesperada: ${request?.method ?? "GET"} ${path}`);
  });
  vi.mocked(authorizedBlob).mockImplementation(async () => {
    if (state.blobError) throw state.blobError;
    return state.blobWait ?? new Blob(["imagem"], { type: "image/webp" });
  });
  return state;
}
function mutations(path?: string) {
  return vi.mocked(authorized).mock.calls.filter(
    ([url, request]) => request?.method && (!path || url === path),
  );
}
function listCalls() {
  return vi.mocked(authorized).mock.calls.filter(
    ([path, request]) => path === "/admin/banners" && !request?.method,
  );
}
function mount(props: Partial<Parameters<typeof BannerPanel>[0]> = {}) {
  return render(
    <BannerPanel
      userId="administrador-de-teste"
      isCurrentSession={currentSession}
      onBusyChange={noop}
      {...props}
    />,
  );
}
async function openEditor(title = "Banner de teste") {
  fireEvent.click(await screen.findByRole("button", { name: `Editar ${title}` }));
  await screen.findByRole("button", { name: "Salvar formulário sem alterações" });
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  vi.stubGlobal("URL", URL);
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:banner-privado"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("BannerPanel", () => {
  it("consulta a lista administrativa sem publicar ou alterar banners", async () => {
    backend();
    mount();
    await screen.findByRole("button", { name: "Editar Banner de teste" });
    expect(authorized).toHaveBeenCalledWith(
      "/admin/banners",
      expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }),
    );
    expect(mutations()).toEqual([]);
    expect(screen.queryByRole("button", { name: /excluir|apagar/i })).toBeNull();
  });

  it("consulta imagens pelo endpoint autenticado e revoga a prévia ao desmontar", async () => {
    backend();
    const view = mount();
    await waitFor(() => expect(authorizedBlob).toHaveBeenCalledTimes(1));
    expect(authorizedBlob).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^/admin/banners/${bannerId}/image\\?v=`)),
      expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }),
    );
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(1));
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:banner-privado");
  });

  it("busca a lista atual novamente antes de editar um registro", async () => {
    const state = backend();
    mount();
    await screen.findByRole("button", { name: "Editar Banner de teste" });
    state.rows = [banner({ title: "Título atualizado por outro administrador" })];
    fireEvent.click(screen.getByRole("button", { name: "Editar Banner de teste" }));
    await screen.findByText("Editor de Título atualizado por outro administrador");
    expect(listCalls()).toHaveLength(2);
    expect(vi.mocked(authorized).mock.calls.some(([path]) => path === `/admin/banners/${bannerId}`)).toBe(false);
  });

  it("não envia um PATCH vazio quando os dados continuam iguais", async () => {
    backend();
    mount();
    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Salvar formulário sem alterações" }));
    await act(async () => {});
    expect(mutations()).toEqual([]);
  });

  it("envia somente o título alterado no PATCH de metadados", async () => {
    backend();
    const onChanged = vi.fn();
    mount({ onChanged });
    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Salvar título alterado" }));
    await waitFor(() => expect(mutations()).toHaveLength(1));
    const [path, request] = mutations()[0];
    expect(path).toBe(`/admin/banners/${bannerId}`);
    expect(request?.method).toBe("PATCH");
    expect(JSON.parse(String(request?.body))).toEqual({ title: "Banner atualizado" });
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it("permite desativar sem excluir o registro ou substituir a imagem", async () => {
    backend();
    mount();
    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Salvar status alterado" }));
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(JSON.parse(String(mutations()[0][1]?.body))).toEqual({ active: false });
    expect(mutations()[0][1]?.method).toBe("PATCH");
  });

  it("envia novo banner com arquivo e os quatro campos em FormData", async () => {
    backend();
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Novo banner" }));
    fireEvent.click(await screen.findByRole("button", { name: "Salvar formulário sem alterações" }));
    await waitFor(() => expect(mutations("/admin/banners")).toHaveLength(1));
    const request = mutations("/admin/banners")[0][1];
    expect(request?.body).toBeInstanceOf(FormData);
    const data = request?.body as FormData;
    expect([...data.keys()].sort()).toEqual(["active", "image", "link", "sortOrder", "title"]);
    expect(data.get("title")).toBe("Banner de teste");
    expect(data.get("link")).toBe("/catalogo");
    expect(data.get("active")).toBe("true");
    expect(data.get("sortOrder")).toBe("2");
    expect(data.get("image")).toBeInstanceOf(File);
    expect(new Headers(request?.headers).has("Content-Type")).toBe(false);
  });

  it("bloqueia o cadastro se não conseguir persistir sua proteção antes do envio", async () => {
    backend();
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Novo banner" }));
    const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Armazenamento indisponível");
    });
    try {
      fireEvent.click(await screen.findByRole("button", { name: "Salvar formulário sem alterações" }));
      await act(async () => {});
      expect(mutations()).toEqual([]);
      expect(screen.getAllByRole("alert").map((alert) => alert.textContent).join(" ")).not.toContain("Armazenamento indisponível");
    } finally {
      storage.mockRestore();
    }
  });

  it("mantém a proteção do cadastro após falha de rede e não repete POST automaticamente", async () => {
    const state = backend();
    state.mutationError = new TypeError("fetch failed: secret interno");
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Novo banner" }));
    fireEvent.click(await screen.findByRole("button", { name: "Salvar formulário sem alterações" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).not.toBe(""));
    expect(sessionStorage.getItem("jornada-admin-banner:administrador-de-teste")).toBe("Banner de teste");
    expect(screen.getByRole("alert").textContent).not.toContain("secret interno");
    expect(mutations("/admin/banners")).toHaveLength(1);
    await act(async () => {});
    expect(mutations("/admin/banners")).toHaveLength(1);
  });

  it("preserva o cadastro incerto após remontar e exige revisão explícita da lista", async () => {
    backend();
    sessionStorage.setItem("jornada-admin-banner:administrador-de-teste", "Banner incerto");
    mount();
    await screen.findByRole("button", { name: "Editar Banner de teste" });
    expect(screen.queryByRole("button", { name: "Liberar novo cadastro" })).toBeNull();
    const create = screen.queryByRole("button", { name: "Novo banner" }) as HTMLButtonElement | null;
    expect(create === null || create.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Revisar cadastros" }));
    fireEvent.click(await screen.findByRole("button", { name: "Liberar novo cadastro" }));
    await waitFor(() => expect(sessionStorage.getItem("jornada-admin-banner:administrador-de-teste")).toBeNull());
    expect((screen.getByRole("button", { name: "Novo banner" }) as HTMLButtonElement).disabled).toBe(false);
    expect(listCalls()).toHaveLength(2);
    expect(mutations()).toEqual([]);
  });

  it("não libera cadastro incerto quando a consulta de revisão falha", async () => {
    const state = backend();
    sessionStorage.setItem("jornada-admin-banner:administrador-de-teste", "Banner incerto");
    mount();
    await screen.findByRole("button", { name: "Editar Banner de teste" });
    state.listError = failure(503);
    fireEvent.click(screen.getByRole("button", { name: "Revisar cadastros" }));
    await waitFor(() => expect(listCalls()).toHaveLength(2));
    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: "Liberar novo cadastro" })).toBeNull();
    expect(sessionStorage.getItem("jornada-admin-banner:administrador-de-teste")).toBe("Banner incerto");
    expect(mutations()).toEqual([]);
  });

  it("não mostra editor quando o registro desaparece na nova consulta", async () => {
    const state = backend();
    mount();
    await screen.findByRole("button", { name: "Editar Banner de teste" });
    state.rows = [];
    fireEvent.click(screen.getByRole("button", { name: "Editar Banner de teste" }));
    await waitFor(() => expect(listCalls()).toHaveLength(2));
    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: "Salvar formulário sem alterações" })).toBeNull();
    expect(mutations()).toEqual([]);
  });

  it("não mostra editor quando a nova consulta administrativa é recusada", async () => {
    const state = backend();
    mount();
    await screen.findByRole("button", { name: "Editar Banner de teste" });
    state.listError = failure(403);
    fireEvent.click(screen.getByRole("button", { name: "Editar Banner de teste" }));
    await screen.findByText(/Acesso restrito a administradores\./);
    expect(screen.queryByRole("button", { name: "Salvar formulário sem alterações" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Novo banner" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Editar Banner de teste" })).toBeNull();
  });

  it("remove os dados administrativos quando uma gravação recebe 403", async () => {
    const state = backend();
    mount();
    await openEditor();
    state.mutationError = failure(403, "Detalhe interno da permissão");
    fireEvent.click(screen.getByRole("button", { name: "Salvar título alterado" }));
    await screen.findByText(/Acesso restrito a administradores\./);
    expect(screen.queryByRole("button", { name: "Salvar formulário sem alterações" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Novo banner" })).toBeNull();
    expect(screen.queryByText("Detalhe interno da permissão")).toBeNull();
    expect(mutations()).toHaveLength(1);
  });

  it("não aplica uma consulta atrasada depois da troca de sessão", async () => {
    const state = backend();
    const pending = deferred<{ data: BannerFixture[] }>();
    state.listWait = pending.promise;
    let sessionIsCurrent = true;
    mount({ isCurrentSession: () => sessionIsCurrent });
    await waitFor(() => expect(listCalls()).toHaveLength(1));
    sessionIsCurrent = false;
    await act(async () => pending.resolve({ data: [banner()] }));
    expect(screen.queryByRole("button", { name: "Editar Banner de teste" })).toBeNull();
    expect(authorizedBlob).not.toHaveBeenCalled();
  });

  it("cancela a consulta ao desmontar e não cria uma prévia de resposta atrasada", async () => {
    const state = backend();
    const pending = deferred<{ data: BannerFixture[] }>();
    state.listWait = pending.promise;
    const view = mount();
    await waitFor(() => expect(listCalls()).toHaveLength(1));
    const signal = listCalls()[0][1]?.signal;
    view.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => pending.resolve({ data: [banner()] }));
    expect(authorizedBlob).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("ignora imagem recebida depois de desmontar sem criar URL persistente", async () => {
    const state = backend();
    const pending = deferred<Blob>();
    state.blobWait = pending.promise;
    const view = mount();
    await waitFor(() => expect(authorizedBlob).toHaveBeenCalledTimes(1));
    const signal = vi.mocked(authorizedBlob).mock.calls[0][1]?.signal;
    view.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => pending.resolve(new Blob(["imagem"])));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("impede gravar a partir de um editor cuja sessão já foi trocada", async () => {
    backend();
    let sessionIsCurrent = true;
    mount({ isCurrentSession: () => sessionIsCurrent });
    await openEditor();
    sessionIsCurrent = false;
    fireEvent.click(screen.getByRole("button", { name: "Salvar título alterado" }));
    await act(async () => {});
    expect(mutations()).toEqual([]);
  });

  it("bloqueia duplo envio enquanto uma gravação ainda está em andamento", async () => {
    const state = backend();
    const pending = deferred<BannerFixture>();
    state.mutationWait = pending.promise;
    const onBusyChange = vi.fn();
    mount({ onBusyChange });
    await openEditor();
    const save = screen.getByRole("button", { name: "Salvar título alterado" });
    fireEvent.click(save);
    fireEvent.click(save);
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(onBusyChange).toHaveBeenLastCalledWith(true);
    expect((screen.getByRole("button", { name: "Voltar aos banners" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => pending.resolve(banner({ title: "Banner atualizado" })));
    await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
  });

  it("não aplica uma gravação antiga nem notifica catálogo depois da troca de sessão", async () => {
    const state = backend();
    const pending = deferred<BannerFixture>();
    state.mutationWait = pending.promise;
    let sessionIsCurrent = true;
    const onChanged = vi.fn();
    mount({ isCurrentSession: () => sessionIsCurrent, onChanged });
    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Salvar título alterado" }));
    await waitFor(() => expect(mutations()).toHaveLength(1));
    sessionIsCurrent = false;
    await act(async () => pending.resolve(banner({ title: "Banner atualizado" })));
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Editar Banner atualizado" })).toBeNull();
  });

  it("interrompe gravação em 15 segundos e não repete a solicitação após timeout", async () => {
    const state = backend();
    state.mutationWait = new Promise<BannerFixture>(() => {});
    const onBusyChange = vi.fn();
    mount({ onBusyChange });
    await openEditor();
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole("button", { name: "Salvar título alterado" }));
      expect(mutations()).toHaveLength(1);
      const signal = mutations()[0][1]?.signal;
      expect(signal?.aborted).toBe(false);
      await act(async () => vi.advanceTimersByTimeAsync(14_999));
      expect(signal?.aborted).toBe(false);
      expect(onBusyChange).toHaveBeenLastCalledWith(true);
      await act(async () => vi.advanceTimersByTimeAsync(1));
      expect(signal?.aborted).toBe(true);
      expect(onBusyChange).toHaveBeenLastCalledWith(false);
      expect(screen.getByRole("alert").textContent).not.toBe("");
      await act(async () => vi.advanceTimersByTimeAsync(30_000));
      expect(mutations()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("não confia no endereço público devolvido pelo servidor para mostrar imagem administrativa", async () => {
    const state = backend();
    state.rows = [banner({ imageUrl: "https://exemplo.invalid/nao-usar.png" })];
    mount();
    await screen.findByRole("button", { name: "Editar Banner de teste" });
    await waitFor(() => expect(authorizedBlob).toHaveBeenCalledTimes(1));
    expect(vi.mocked(authorizedBlob).mock.calls[0][0]).toMatch(
      new RegExp(`^/admin/banners/${bannerId}/image\\?v=`),
    );
    expect(document.querySelector('img[src="https://exemplo.invalid/nao-usar.png"]')).toBeNull();
  });

  it("grava a proteção antes de emitir POST e limpa somente após confirmação do cadastro", async () => {
    const state = backend();
    const pending = deferred<BannerFixture>();
    state.mutationWait = pending.promise;
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Novo banner" }));
    fireEvent.click(await screen.findByRole("button", { name: "Salvar formulário sem alterações" }));
    await waitFor(() => expect(mutations("/admin/banners")).toHaveLength(1));
    expect(sessionStorage.getItem("jornada-admin-banner:administrador-de-teste")).toBe("Banner de teste");
    await act(async () => pending.resolve(banner()));
    await waitFor(() => expect(sessionStorage.getItem("jornada-admin-banner:administrador-de-teste")).toBeNull());
  });

  it("não limpa uma tentativa mais recente com uma resposta de criação antiga", async () => {
    const state = backend();
    const pending = deferred<BannerFixture>();
    state.mutationWait = pending.promise;
    let sessionIsCurrent = true;
    mount({ isCurrentSession: () => sessionIsCurrent });
    fireEvent.click(await screen.findByRole("button", { name: "Novo banner" }));
    fireEvent.click(await screen.findByRole("button", { name: "Salvar formulário sem alterações" }));
    await waitFor(() => expect(mutations("/admin/banners")).toHaveLength(1));
    sessionIsCurrent = false;
    sessionStorage.setItem("jornada-admin-banner:administrador-de-teste", "Nova tentativa independente");
    await act(async () => pending.resolve(banner()));
    expect(sessionStorage.getItem("jornada-admin-banner:administrador-de-teste")).toBe("Nova tentativa independente");
  });

  it("troca somente a imagem após revisar e confirmar o arquivo escolhido", async () => {
    backend();
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Trocar imagem de Banner de teste" }));
    const file = image();
    fireEvent.change(await screen.findByLabelText("Nova imagem"), { target: { files: [file] } });
    expect(mutations()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Revisar imagem" }));
    expect(mutations()).toEqual([]);
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar troca" }));
    await waitFor(() => expect(mutations()).toHaveLength(1));
    const [path, request] = mutations()[0];
    expect(path).toBe(`/admin/banners/${bannerId}/image`);
    expect(request?.method).toBe("POST");
    const data = request?.body as FormData;
    expect(data).toBeInstanceOf(FormData);
    expect([...data.keys()]).toEqual(["image"]);
    expect(data.get("image")).toBe(file);
    expect(new Headers(request?.headers).has("Content-Type")).toBe(false);
  });

  it("voltar da revisão de imagem não grava nem preserva a confirmação anterior", async () => {
    backend();
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Trocar imagem de Banner de teste" }));
    fireEvent.change(await screen.findByLabelText("Nova imagem"), { target: { files: [image()] } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar imagem" }));
    fireEvent.click(await screen.findByRole("button", { name: "Voltar à imagem" }));
    expect(screen.queryByRole("button", { name: "Confirmar troca" })).toBeNull();
    expect((screen.getByLabelText("Nova imagem") as HTMLInputElement).disabled).toBe(false);
    expect(mutations()).toEqual([]);
  });

  it("não repete troca de imagem que falhou e exige consultar a lista novamente", async () => {
    const state = backend();
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Trocar imagem de Banner de teste" }));
    fireEvent.change(await screen.findByLabelText("Nova imagem"), { target: { files: [image()] } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar imagem" }));
    state.mutationError = failure(503, "Detalhe da conexão interna");
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar troca" }));
    await screen.findByRole("alert");
    expect(mutations()).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Confirmar troca" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Trocar imagem de Banner de teste" })).toBeNull();
    expect(screen.getByRole("alert").textContent).not.toContain("Detalhe da conexão interna");
    fireEvent.click(screen.getByRole("button", { name: "Atualizar banners" }));
    await screen.findByRole("button", { name: "Trocar imagem de Banner de teste" });
    expect(mutations()).toHaveLength(1);
  });

  it("não confirma a troca de imagem depois de perder a sessão", async () => {
    backend();
    let sessionIsCurrent = true;
    mount({ isCurrentSession: () => sessionIsCurrent });
    fireEvent.click(await screen.findByRole("button", { name: "Trocar imagem de Banner de teste" }));
    fireEvent.change(await screen.findByLabelText("Nova imagem"), { target: { files: [image()] } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar imagem" }));
    sessionIsCurrent = false;
    fireEvent.click(screen.getByRole("button", { name: "Confirmar troca" }));
    expect(mutations()).toEqual([]);
  });

  it("retira prova de revisão ao iniciar uma nova consulta, mesmo que ela falhe", async () => {
    const state = backend();
    sessionStorage.setItem("jornada-admin-banner:administrador-de-teste", "Banner incerto");
    mount();
    await screen.findByRole("button", { name: "Editar Banner de teste" });
    fireEvent.click(screen.getByRole("button", { name: "Revisar cadastros" }));
    await screen.findByRole("button", { name: "Liberar novo cadastro" });
    const pending = deferred<{ data: BannerFixture[] }>();
    state.listWait = pending.promise;
    fireEvent.click(screen.getByRole("button", { name: "Atualizar banners" }));
    expect(screen.queryByRole("button", { name: "Liberar novo cadastro" })).toBeNull();
    await act(async () => pending.reject(failure(503)));
    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: "Liberar novo cadastro" })).toBeNull();
    expect(sessionStorage.getItem("jornada-admin-banner:administrador-de-teste")).toBe("Banner incerto");
  });

  it("oculta a área administrativa se a prévia autenticada recebe 403", async () => {
    const state = backend();
    state.blobError = failure(403);
    mount();
    await screen.findByText(/Acesso restrito a administradores\./);
    expect(screen.queryByRole("button", { name: "Novo banner" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Editar Banner de teste" })).toBeNull();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("recusa dados inválidos da lista sem expor um editor baseado neles", async () => {
    const state = backend();
    state.rows = [banner({ id: "id-inválido" })];
    mount();
    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: "Editar Banner de teste" })).toBeNull();
    expect(authorizedBlob).not.toHaveBeenCalled();
    expect(mutations()).toEqual([]);
  });

  it("pagina seis banners sem consultar novamente a lista e libera as prévias da página anterior", async () => {
    const state = backend();
    state.rows = Array.from({ length: 7 }, (_, index) => banner({
      id: `${index + 1}dc068c0-d16d-4081-9d00-a73707709887`,
      title: `Banner ${index + 1}`,
      sortOrder: index,
    }));
    vi.mocked(URL.createObjectURL).mockImplementationOnce(() => "blob:pagina-1-banner-1");
    mount();
    await screen.findByRole("button", { name: "Editar Banner 1" });
    await waitFor(() => expect(authorizedBlob).toHaveBeenCalledTimes(6));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(6));
    expect(screen.getAllByRole("button", { name: /^Editar Banner \d$/ })).toHaveLength(6);
    expect(screen.queryByRole("button", { name: "Editar Banner 7" })).toBeNull();
    expect(listCalls()).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    await screen.findByRole("button", { name: "Editar Banner 7" });
    await waitFor(() => expect(authorizedBlob).toHaveBeenCalledTimes(7));
    expect(screen.getAllByRole("button", { name: /^Editar Banner \d$/ })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Editar Banner 1" })).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(6);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:pagina-1-banner-1");
    expect(vi.mocked(authorizedBlob).mock.calls[6][0]).toContain(`/admin/banners/${state.rows[6].id}/image?`);
    expect(listCalls()).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Anterior" }));
    await screen.findByRole("button", { name: "Editar Banner 1" });
    await waitFor(() => expect(authorizedBlob).toHaveBeenCalledTimes(13));
    expect(screen.queryByRole("button", { name: "Editar Banner 7" })).toBeNull();
    expect(listCalls()).toHaveLength(1);
    expect(mutations()).toEqual([]);
  });
});
