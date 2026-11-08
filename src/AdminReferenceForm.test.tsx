// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminReferenceForm } from "./AdminReferenceForm";
import type { AdminReferenceFormProps } from "./AdminReferenceForm";
import type { ReferenceKind } from "./admin-references";

const defaults = (): AdminReferenceFormProps => ({
  kind: "category",
  busy: false,
  isCurrentSession: () => true,
  onSubmit: vi.fn(async () => {}),
  onCancel: vi.fn(),
});
function setup(props: Partial<AdminReferenceFormProps> = {}) {
  const callbacks = { ...defaults(), ...props };
  return { ...render(<AdminReferenceForm {...callbacks} />), props: callbacks };
}
const identifierLabel = (kind: ReferenceKind) =>
  kind === "category"
    ? "Identificador da categoria"
    : kind === "condition"
      ? "Código da condição"
      : "Código do idioma";
function fill(kind: ReferenceKind = "category") {
  fireEvent.change(screen.getByLabelText("Nome"), {
    target: { value: " Nome de teste " },
  });
  fireEvent.change(screen.getByLabelText(identifierLabel(kind)), {
    target: { value: kind === "category" ? " SINGLES " : " pt-br " },
  });
}
function submit() {
  fireEvent.submit(screen.getByLabelText("Nome").closest("form")!);
}
function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
afterEach(cleanup);
describe("AdminReferenceForm", () => {
  it.each([
    ["category", "Nova categoria", "Salvar categoria"],
    ["condition", "Nova condição", "Salvar condição"],
    ["language", "Novo idioma", "Salvar idioma"],
  ] as const)(
    "uses associated fields and appropriate actions for %s",
    (kind, heading, save) => {
      const { props } = setup({ kind });
      expect(screen.getByRole("heading", { name: heading }).tagName).toBe("H3");
      expect(screen.getByRole("button", { name: save })).toBeTruthy();
      expect(
        screen.getByLabelText(identifierLabel(kind)).getAttribute("maxlength"),
      ).toBe(kind === "category" ? "100" : "20");
      expect(screen.getByLabelText("Nome").getAttribute("maxlength")).toBe(
        "120",
      );
      expect(document.activeElement).toBe(screen.getByLabelText("Nome"));
      expect(props.onSubmit).not.toHaveBeenCalled();
      expect(Boolean(screen.queryByLabelText("Descrição (opcional)"))).toBe(
        kind !== "language",
      );
    },
  );
  it("shows errors linked to the invalid fields and focuses the first one", () => {
    const { props } = setup();
    submit();
    const name = screen.getByLabelText("Nome");
    const identifier = screen.getByLabelText("Identificador da categoria");
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(identifier.getAttribute("aria-invalid")).toBe("true");
    expect(
      document.getElementById(name.getAttribute("aria-describedby")!)
        ?.textContent,
    ).toContain("Informe um nome");
    expect(identifier.getAttribute("aria-describedby")).toContain(
      "identifier-error",
    );
    expect(document.activeElement).toBe(name);
    expect(props.onSubmit).not.toHaveBeenCalled();
  });
  it.each(["category", "condition", "language"] as const)(
    "submits normalized %s data without empty or irrelevant fields",
    async (kind) => {
      const { props } = setup({ kind });
      fill(kind);
      submit();
      await act(async () => {});
      expect(props.onSubmit).toHaveBeenCalledWith({
        name: "Nome de teste",
        ...(kind === "category" ? { slug: "singles" } : { code: "PT-BR" }),
        ...(kind === "language" ? {} : { description: null }),
      });
      expect(props.onSubmit).toHaveBeenCalledTimes(1);
    },
  );
  it("allows a multiline description while rejecting non-text controls", async () => {
    const { props } = setup();
    fill();
    fireEvent.change(screen.getByLabelText("Descrição (opcional)"), {
      target: { value: " Primeira linha\n\tSegunda linha " },
    });
    submit();
    await act(async () => {});
    expect(props.onSubmit).toHaveBeenCalledWith({
      name: "Nome de teste",
      slug: "singles",
      description: "Primeira linha\n\tSegunda linha",
    });
    fireEvent.change(screen.getByLabelText("Descrição (opcional)"), {
      target: { value: `Texto${String.fromCharCode(0)}` },
    });
    submit();
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
    expect(
      screen
        .getByLabelText("Descrição (opcional)")
        .getAttribute("aria-invalid"),
    ).toBe("true");
  });
  it("keeps the draft after callback success so a parent can retain known validation/conflict results", async () => {
    setup();
    fill();
    submit();
    await act(async () => {});
    expect((screen.getByLabelText("Nome") as HTMLInputElement).value).toBe(
      " Nome de teste ",
    );
    expect(
      (screen.getByLabelText("Identificador da categoria") as HTMLInputElement)
        .value,
    ).toBe(" SINGLES ");
  });
  it("blocks duplicate submits, cancel and editing while the callback is pending", async () => {
    const pending = deferred();
    const { props } = setup({ onSubmit: vi.fn(() => pending.promise) });
    fill();
    submit();
    submit();
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
    expect(
      (screen.getByLabelText("Nome").closest("fieldset") as HTMLFieldSetElement)
        .disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Cancelar cadastro",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.change(screen.getByLabelText("Nome"), {
      target: { value: "alteração concorrente" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar cadastro" }));
    expect((screen.getByLabelText("Nome") as HTMLInputElement).value).toBe(
      " Nome de teste ",
    );
    expect(props.onCancel).not.toHaveBeenCalled();
    await act(async () => pending.resolve());
    expect(
      (
        screen.getByRole("button", {
          name: "Salvar categoria",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });
  it("respects an external busy flag even on programmatic submit", () => {
    const view = setup();
    fill();
    view.rerender(<AdminReferenceForm {...view.props} busy />);
    submit();
    expect(view.props.onSubmit).not.toHaveBeenCalled();
    expect(
      (
        screen.getByRole("button", {
          name: "Cancelar cadastro",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
  it("does not submit or cancel in an obsolete session", () => {
    let valid = true;
    const { props } = setup({ isCurrentSession: () => valid });
    fill();
    valid = false;
    submit();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar cadastro" }));
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(props.onCancel).not.toHaveBeenCalled();
  });
  it("cancels explicitly without a submit", () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar cadastro" }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onSubmit).not.toHaveBeenCalled();
  });
  it("uses the latest callback props without resetting the draft", async () => {
    const view = setup();
    fill();
    const changed = vi.fn(async () => {});
    view.rerender(<AdminReferenceForm {...view.props} onSubmit={changed} />);
    submit();
    await act(async () => {});
    expect(changed).toHaveBeenCalledTimes(1);
    expect(view.props.onSubmit).not.toHaveBeenCalled();
  });
  it("displays a fixed error instead of private caller text", async () => {
    setup({
      onSubmit: vi.fn(async () => {
        throw new Error("private token/provider error");
      }),
    });
    fill();
    submit();
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).not.toContain("private");
    expect(screen.getByRole("alert").textContent).toContain("Atualize a lista");
    fireEvent.change(screen.getByLabelText("Nome"), {
      target: { value: "Outro nome" },
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("resets fields when changing the reference kind", () => {
    const view = setup();
    fill();
    fireEvent.change(screen.getByLabelText("Descrição (opcional)"), {
      target: { value: "Descrição da categoria" },
    });
    view.rerender(<AdminReferenceForm {...view.props} kind="language" />);
    expect(screen.queryByLabelText("Descrição (opcional)")).toBeNull();
    expect((screen.getByLabelText("Nome") as HTMLInputElement).value).toBe("");
    expect(
      (screen.getByLabelText("Código do idioma") as HTMLInputElement).value,
    ).toBe("");
    expect(document.activeElement).toBe(screen.getByLabelText("Nome"));
  });
  it("ignores an old callback failure after kind replacement", async () => {
    const pending = deferred();
    const view = setup({ onSubmit: () => pending.promise });
    fill();
    submit();
    view.rerender(
      <AdminReferenceForm
        {...view.props}
        kind="language"
        onSubmit={async () => {}}
      />,
    );
    await act(async () => pending.reject(new Error("private")));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("heading", { name: "Novo idioma" })).toBeTruthy();
  });
  it("discards late callback errors after unmount", async () => {
    const pending = deferred();
    const view = setup({ onSubmit: () => pending.promise });
    fill();
    submit();
    view.unmount();
    await act(async () => pending.reject(new Error("private")));
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("does not persist a draft in browser storage", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem");
    try {
      setup();
      fill();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
