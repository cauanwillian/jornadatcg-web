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
import { BannerEditor, BannerImagePicker } from "./AdminBannerEditor";
import { inspectBannerImage } from "./admin-banners";
import type { AdminBanner } from "./admin-banners";

vi.mock("./admin-banners", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./admin-banners")>()),
  inspectBannerImage: vi.fn(),
}));

const banner: AdminBanner = {
  id: "10000000-0000-4000-8000-000000000001",
  title: "Novidades da loja",
  link: "/#catalogo",
  active: true,
  sortOrder: 2,
  imageUrl: "https://images.example.test/banner.png",
  createdAt: "2026-10-22T00:00:00.000Z",
  updatedAt: "2026-10-22T00:00:00.000Z",
};

const nativeURL = globalThis.URL;
const createObjectURL = vi.fn(() => "blob:banner-preview");
const revokeObjectURL = vi.fn();

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function setup(overrides: Partial<Parameters<typeof BannerEditor>[0]> = {}) {
  const props = {
    busy: false,
    onSave: vi.fn().mockResolvedValue(true),
    onCancel: vi.fn(),
    isCurrentSession: () => true,
    ...overrides,
  };
  return { ...render(<BannerEditor {...props} />), props };
}

function validTitle() {
  fireEvent.change(screen.getByLabelText("Título do banner"), {
    target: { value: "  Destaques da semana  " },
  });
}

function select(file: File | null, label = "Imagem do banner") {
  fireEvent.change(screen.getByLabelText(label), {
    target: { files: file ? [file] : [] },
  });
}

function image(name = "banner.png", type = "image/png") {
  return new File(["imagem de teste"], name, { type });
}

async function validImage(file = image()) {
  select(file);
  await screen.findByRole("img", { name: "Prévia da imagem selecionada" });
  return file;
}

function submit(name = "Cadastrar banner") {
  fireEvent.submit(screen.getByRole("button", { name }).closest("form")!);
}

beforeEach(() => {
  vi.resetAllMocks();
  createObjectURL.mockReturnValue("blob:banner-preview");
  vi.mocked(inspectBannerImage).mockResolvedValue(undefined);
  vi.stubGlobal(
    "URL",
    class extends nativeURL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Administrative banner editor", () => {
  it("starts a new banner inactive without saving or inspecting automatically", () => {
    const { props } = setup();
    expect(screen.getByRole<HTMLInputElement>("checkbox").checked).toBe(false);
    expect(screen.getByLabelText<HTMLInputElement>("Ordem de exibição").value).toBe("0");
    expect(screen.getByPlaceholderText("/#catalogo")).toBeTruthy();
    expect(screen.getByText(/1600 × 500 px/)).toBeTruthy();
    expect(inspectBannerImage).not.toHaveBeenCalled();
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it("requires title and a file with accessible inline errors", () => {
    const { props } = setup();
    submit();
    expect(props.onSave).not.toHaveBeenCalled();
    for (const label of ["Título do banner", "Imagem do banner"]) {
      const field = screen.getByLabelText(label);
      expect(field.getAttribute("aria-invalid")).toBe("true");
      const descriptions = field.getAttribute("aria-describedby")!.split(" ");
      expect(descriptions.some((id) => document.getElementById(id)?.textContent)).toBe(true);
    }
    expect(screen.getByRole("alert").textContent).toContain("Confira os campos");
  });

  it("saves normalized metadata and a validated file only after explicit submission", async () => {
    const { props } = setup();
    validTitle();
    const selected = await validImage();
    fireEvent.change(screen.getByLabelText("Destino do banner (opcional)"), {
      target: { value: "/#catalogo" },
    });
    fireEvent.change(screen.getByLabelText("Ordem de exibição"), {
      target: { value: " 12 " },
    });
    fireEvent.click(screen.getByLabelText("Banner ativo"));
    expect(props.onSave).not.toHaveBeenCalled();
    submit();
    await waitFor(() => expect(props.onSave).toHaveBeenCalledOnce());
    expect(props.onSave).toHaveBeenCalledWith(
      {
        title: "Destaques da semana",
        link: "/#catalogo",
        active: true,
        sortOrder: 12,
      },
      selected,
    );
    expect(inspectBannerImage).toHaveBeenCalledWith(selected, expect.any(AbortSignal));
  });

  it("edits metadata without requesting or sending an image", async () => {
    const { props } = setup({ banner });
    expect(screen.queryByLabelText("Imagem do banner")).toBeNull();
    expect(screen.getByText(/Para trocar a imagem/)).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
    validTitle();
    fireEvent.change(screen.getByLabelText("Destino do banner (opcional)"), {
      target: { value: "" },
    });
    submit("Salvar alterações");
    await waitFor(() => expect(props.onSave).toHaveBeenCalledOnce());
    expect(props.onSave).toHaveBeenCalledWith(
      { title: "Destaques da semana", link: null, active: true, sortOrder: 2 },
      null,
    );
    expect(inspectBannerImage).not.toHaveBeenCalled();
  });

  it("uses a trusted preview supplied by the parent without opening the public image URL", () => {
    setup({
      banner,
      preview: <img src="blob:protected-admin-preview" alt="Prévia protegida do banner" />,
    });
    expect(screen.getByRole("img").getAttribute("src")).toBe("blob:protected-admin-preview");
    expect(document.querySelector(`img[src="${banner.imageUrl}"]`)).toBeNull();
    expect(inspectBannerImage).not.toHaveBeenCalled();
  });

  it.each([
    ["Título do banner", " ", "title"],
    ["Título do banner", "a".repeat(121), "title"],
    ["Destino do banner (opcional)", "https://example.test", "link"],
    ["Destino do banner (opcional)", "//example.test", "link"],
    ["Destino do banner (opcional)", "/\\example.test", "link"],
    ["Destino do banner (opcional)", "/catalogo%20", "link"],
    ["Ordem de exibição", "-1", "sortOrder"],
    ["Ordem de exibição", "1000000", "sortOrder"],
    ["Ordem de exibição", "1.5", "sortOrder"],
  ])("rejects invalid %s value %s", (label, value) => {
    const { props } = setup({ banner });
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    submit("Salvar alterações");
    expect(props.onSave).not.toHaveBeenCalled();
    expect(screen.getByLabelText(label).getAttribute("aria-invalid")).toBe("true");
  });

  it("blocks submit while dimensions are being checked", async () => {
    const inspection = deferred<void>();
    vi.mocked(inspectBannerImage).mockReturnValue(inspection.promise);
    const { props } = setup();
    validTitle();
    const selected = image();
    select(selected);
    expect(screen.getByRole("status").textContent).toBe("Verificando imagem…");
    submit();
    expect(props.onSave).not.toHaveBeenCalled();
    await act(async () => inspection.resolve(undefined));
    submit();
    expect(props.onSave).toHaveBeenCalledWith(expect.any(Object), selected);
  });

  it("does not accept an image whose dimensions cannot be validated", async () => {
    vi.mocked(inspectBannerImage).mockRejectedValue(new Error("internal image failure"));
    const { props } = setup();
    validTitle();
    select(image());
    await screen.findByText(/Não foi possível validar esta imagem/);
    submit();
    expect(props.onSave).not.toHaveBeenCalled();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByText("internal image failure")).toBeNull();
    expect(screen.getByLabelText("Imagem do banner").getAttribute("aria-invalid")).toBe("true");
  });

  it.each([
    image("banner.svg", "image/svg+xml"),
    new File([], "empty.png", { type: "image/png" }),
    new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.png", { type: "image/png" }),
  ])("rejects an unsupported, empty or oversized file before decoding", async (selected) => {
    const { props } = setup();
    validTitle();
    select(selected);
    submit();
    expect(inspectBannerImage).not.toHaveBeenCalled();
    expect(props.onSave).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Imagem do banner").getAttribute("aria-invalid")).toBe("true");
  });

  it("blocks duplicate submissions and cancellation until saving settles", async () => {
    const saving = deferred<boolean>();
    const { props } = setup({ banner, onSave: vi.fn(() => saving.promise) });
    submit("Salvar alterações");
    submit("Salvando…");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar edição" }));
    expect(props.onSave).toHaveBeenCalledOnce();
    expect(props.onCancel).not.toHaveBeenCalled();
    await act(async () => saving.resolve(false));
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Salvar alterações" }).disabled).toBe(false);
  });

  it("shows a safe error if the save callback rejects and retains the draft", async () => {
    setup({ banner, onSave: vi.fn().mockRejectedValue(new Error("secret provider error")) });
    validTitle();
    submit("Salvar alterações");
    await screen.findByText(/Não foi possível salvar o banner/);
    expect(screen.queryByText("secret provider error")).toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>("Título do banner").value).toBe("  Destaques da semana  ");
  });

  it("respects the parent mutation lock", () => {
    const { props } = setup({ banner, busy: true });
    submit("Salvar alterações");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar edição" }));
    expect(props.onSave).not.toHaveBeenCalled();
    expect(props.onCancel).not.toHaveBeenCalled();
  });

  it("stops a save after the authenticated session changes", () => {
    let current = true;
    const { props } = setup({ banner, isCurrentSession: () => current });
    current = false;
    submit("Salvar alterações");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar edição" }));
    expect(props.onSave).not.toHaveBeenCalled();
    expect(props.onCancel).not.toHaveBeenCalled();
  });

  it("cancels editing only when requested", () => {
    const { props } = setup();
    expect(props.onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar edição" }));
    expect(props.onCancel).toHaveBeenCalledOnce();
    expect(props.onSave).not.toHaveBeenCalled();
  });
});

describe("Reusable banner image picker", () => {
  function picker(overrides: Partial<Parameters<typeof BannerImagePicker>[0]> = {}) {
    const props = {
      disabled: false,
      onChange: vi.fn(),
      onValidating: vi.fn(),
      isCurrentSession: () => true,
      ...overrides,
    };
    return { ...render(<BannerImagePicker {...props} />), props };
  }

  it("supports a replacement label, clears the old selection immediately and emits only validated files", async () => {
    const inspection = deferred<void>();
    vi.mocked(inspectBannerImage).mockReturnValue(inspection.promise);
    const { props } = picker({ label: "Nova imagem" });
    const selected = image();
    select(selected, "Nova imagem");
    expect(props.onChange).toHaveBeenCalledExactlyOnceWith(null);
    expect(props.onValidating).toHaveBeenCalledWith(true);
    await act(async () => inspection.resolve(undefined));
    expect(props.onChange).toHaveBeenLastCalledWith(selected);
    expect(props.onValidating).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole("img").getAttribute("src")).toBe("blob:banner-preview");
  });

  it("aborts the prior inspection and ignores its result when another file is selected", async () => {
    const first = deferred<void>();
    const second = deferred<void>();
    vi.mocked(inspectBannerImage).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { props } = picker();
    const oldFile = image("old.png");
    const newFile = image("new.webp", "image/webp");
    select(oldFile);
    const firstSignal = vi.mocked(inspectBannerImage).mock.calls[0][1]!;
    select(newFile);
    expect(firstSignal.aborted).toBe(true);
    await act(async () => second.resolve(undefined));
    await act(async () => first.resolve(undefined));
    expect(vi.mocked(props.onChange).mock.calls.map(([file]) => file)).toEqual([null, null, newFile]);
    expect(createObjectURL).toHaveBeenCalledExactlyOnceWith(newFile);
  });

  it("ignores an old inspection error after the current image has been accepted", async () => {
    const first = deferred<void>();
    vi.mocked(inspectBannerImage).mockReturnValueOnce(first.promise).mockResolvedValueOnce(undefined);
    picker();
    select(image("old.png"));
    select(image("new.png"));
    await screen.findByRole("img");
    await act(async () => first.reject(new Error("late old error")));
    expect(screen.queryByText(/Não foi possível validar/)).toBeNull();
    expect(screen.getByLabelText("Imagem do banner").getAttribute("aria-invalid")).toBe("false");
  });

  it("revokes old previews on replacement and the remaining preview on unmount", async () => {
    createObjectURL.mockReturnValueOnce("blob:first").mockReturnValueOnce("blob:second");
    const { unmount } = picker();
    select(image("first.png"));
    await screen.findByRole("img");
    select(image("second.png"));
    await waitFor(() => expect(screen.getByRole("img").getAttribute("src")).toBe("blob:second"));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:first");
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:second");
  });

  it("clears a previously valid file and preview when the file chooser is emptied", async () => {
    const { props } = picker();
    select(image());
    await screen.findByRole("img");
    select(null);
    expect(props.onChange).toHaveBeenLastCalledWith(null);
    expect(screen.queryByRole("img")).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:banner-preview");
  });

  it("aborts on unmount without late preview creation or callbacks", async () => {
    const inspection = deferred<void>();
    vi.mocked(inspectBannerImage).mockReturnValue(inspection.promise);
    const { props, unmount } = picker();
    select(image());
    const signal = vi.mocked(inspectBannerImage).mock.calls[0][1]!;
    unmount();
    await act(async () => inspection.resolve(undefined));
    expect(signal.aborted).toBe(true);
    expect(props.onChange).toHaveBeenCalledExactlyOnceWith(null);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("discards validation if the session is replaced during decoding", async () => {
    let current = true;
    const inspection = deferred<void>();
    vi.mocked(inspectBannerImage).mockReturnValue(inspection.promise);
    const { props } = picker({ isCurrentSession: () => current });
    select(image());
    current = false;
    await act(async () => inspection.resolve(undefined));
    expect(props.onChange).toHaveBeenCalledExactlyOnceWith(null);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("ignores file change events when disabled", () => {
    const { props } = picker({ disabled: true });
    select(image());
    expect(props.onChange).not.toHaveBeenCalled();
    expect(inspectBannerImage).not.toHaveBeenCalled();
  });
});
