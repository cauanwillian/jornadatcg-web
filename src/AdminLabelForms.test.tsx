// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  CreateLabelForm,
  LabelCheckoutForm,
  RecoveryLabelForm,
} from "./AdminLabelForms";

const current = () => true;
const recipient = {
  recipientDocument: "529.982.247-25",
  recipientPhone: "(11) 99999-1234",
};
const invoice = "1".repeat(44);
const remoteId = "7BB64FD8-AC67-440F-9B04-EAEE73F75C3B";

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function field(name: string | RegExp) {
  return screen.getByLabelText<HTMLInputElement>(name);
}
function fillRecipient(withInvoice = false) {
  fireEvent.change(field("CPF do destinatário"), {
    target: { value: recipient.recipientDocument },
  });
  fireEvent.change(field("Telefone do destinatário com DDD"), {
    target: { value: recipient.recipientPhone },
  });
  if (withInvoice)
    fireEvent.change(field(/^Chave da nota fiscal/), {
      target: { value: invoice },
    });
}
function review() {
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "Revisei os dados do destinatário e a embalagem",
    }),
  );
}
function submit(name: string) {
  fireEvent.submit(screen.getByRole("form", { name }));
}
function invalid(name: string | RegExp) {
  const input = field(name);
  expect(input.getAttribute("aria-invalid")).toBe("true");
  const id = input.getAttribute("aria-describedby");
  expect(id).toBeTruthy();
  expect(document.getElementById(id!)?.textContent).toBeTruthy();
}
function expectRecipientCleared() {
  for (const name of [
    "CPF do destinatário",
    "Telefone do destinatário com DDD",
    /^Chave da nota fiscal/,
  ])
    expect(field(name).value).toBe("");
  expect(screen.getByRole<HTMLInputElement>("checkbox").checked).toBe(false);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Create label form", () => {
  it("renders accessible blank fields and never submits automatically", () => {
    const onSubmit = vi.fn();
    render(
      <CreateLabelForm
        busy={false}
        production={false}
        isCurrentSession={current}
        onSubmit={onSubmit}
      />,
    );
    for (const name of [
      "CPF do destinatário",
      "Telefone do destinatário com DDD",
      /^Chave da nota fiscal/,
    ]) {
      expect(field(name).value).toBe("");
      expect(field(name).getAttribute("autocomplete")).toBe("off");
    }
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("associates recipient errors and requires an explicit review before submission", () => {
    const onSubmit = vi.fn();
    render(
      <CreateLabelForm
        busy={false}
        production={false}
        isCurrentSession={current}
        onSubmit={onSubmit}
      />,
    );
    submit("Criar etiqueta");
    invalid("CPF do destinatário");
    invalid("Telefone do destinatário com DDD");
    expect(
      screen.getByText("Confirme a revisão dos dados e da embalagem."),
    ).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not accept valid data without reviewing it", () => {
    const onSubmit = vi.fn();
    render(
      <CreateLabelForm
        busy={false}
        production={false}
        isCurrentSession={current}
        onSubmit={onSubmit}
      />,
    );
    fillRecipient();
    submit("Criar etiqueta");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(
      screen.getByText("Confirme a revisão dos dados e da embalagem."),
    ).toBeTruthy();
  });

  it.each([
    ["CPF do destinatário", "111.111.111-11"],
    ["Telefone do destinatário com DDD", "fone11999991234"],
    [/^Chave da nota fiscal/, "123"],
  ])("rejects invalid %s even after confirmation", (label, value) => {
    const onSubmit = vi.fn();
    render(
      <CreateLabelForm
        busy={false}
        production={false}
        isCurrentSession={current}
        onSubmit={onSubmit}
      />,
    );
    fillRecipient();
    fireEvent.change(field(label), { target: { value } });
    review();
    submit("Criar etiqueta");
    invalid(label);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("normalizes sandbox recipient data, omits the optional invoice and clears all fields after an attempt", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const persist = vi.spyOn(Storage.prototype, "setItem");
    render(
      <CreateLabelForm
        busy={false}
        production={false}
        isCurrentSession={current}
        onSubmit={onSubmit}
      />,
    );
    fillRecipient();
    review();
    submit("Criar etiqueta");
    await waitFor(expectRecipientCleared);
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
      recipientDocument: "52998224725",
      recipientPhone: "11999991234",
    });
    expect(persist).not.toHaveBeenCalled();
    expect(screen.queryByText(/52998224725|11999991234/)).toBeNull();
  });

  it("requires a fiscal key in production and sends it only when supplied", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <CreateLabelForm
        busy={false}
        production
        isCurrentSession={current}
        onSubmit={onSubmit}
      />,
    );
    fillRecipient();
    review();
    submit("Criar etiqueta");
    invalid("Chave da nota fiscal");
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.change(field("Chave da nota fiscal"), {
      target: { value: invoice },
    });
    review();
    submit("Criar etiqueta");
    await waitFor(expectRecipientCleared);
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
      recipientDocument: "52998224725",
      recipientPhone: "11999991234",
      invoiceKey: invoice,
    });
  });

  it("invalidates recipient review when an input changes", () => {
    const onSubmit = vi.fn();
    render(
      <CreateLabelForm
        busy={false}
        production={false}
        isCurrentSession={current}
        onSubmit={onSubmit}
      />,
    );
    fillRecipient();
    review();
    fireEvent.change(field("Telefone do destinatário com DDD"), {
      target: { value: "(11) 98888-1234" },
    });
    expect(screen.getByRole<HTMLInputElement>("checkbox").checked).toBe(false);
    submit("Criar etiqueta");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("blocks duplicate requests while an attempt is pending", async () => {
    const pending = deferred();
    const onSubmit = vi.fn().mockReturnValue(pending.promise);
    render(
      <CreateLabelForm
        busy={false}
        production={false}
        isCurrentSession={current}
        onSubmit={onSubmit}
      />,
    );
    fillRecipient();
    review();
    submit("Criar etiqueta");
    submit("Criar etiqueta");
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(field("CPF do destinatário").closest("fieldset")?.disabled).toBe(
      true,
    );
    await act(async () => pending.resolve());
    expectRecipientCleared();
  });

  it("ignores form events after the current session ends", () => {
    let active = true;
    const onSubmit = vi.fn();
    render(
      <CreateLabelForm
        busy={false}
        production={false}
        isCurrentSession={() => active}
        onSubmit={onSubmit}
      />,
    );
    fillRecipient();
    review();
    active = false;
    submit("Criar etiqueta");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("respects a busy parent even for a manually dispatched submit", () => {
    const onSubmit = vi.fn();
    const view = render(
      <CreateLabelForm
        busy={false}
        production={false}
        isCurrentSession={current}
        onSubmit={onSubmit}
      />,
    );
    fillRecipient();
    review();
    view.rerender(
      <CreateLabelForm
        busy
        production={false}
        isCurrentSession={current}
        onSubmit={onSubmit}
      />,
    );
    submit("Criar etiqueta");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("clears sensitive values after rejection and never exposes the caller's error", async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValue(
        new Error(`secret 52998224725 11999991234 ${invoice}`),
      );
    render(
      <CreateLabelForm
        busy={false}
        production={false}
        isCurrentSession={current}
        onSubmit={onSubmit}
      />,
    );
    fillRecipient(true);
    review();
    submit("Criar etiqueta");
    await waitFor(expectRecipientCleared);
    expect(screen.getByRole("alert").textContent).toBe(
      "Não foi possível concluir a criação. Consulte a etiqueta antes de tentar novamente.",
    );
    expect(document.body.textContent).not.toMatch(
      /secret|52998224725|11999991234/,
    );
  });

  it("clears fields on unmount and discards a late result", async () => {
    const pending = deferred();
    const onSubmit = vi.fn().mockReturnValue(pending.promise);
    const view = render(
      <CreateLabelForm
        busy={false}
        production={false}
        isCurrentSession={current}
        onSubmit={onSubmit}
      />,
    );
    fillRecipient(true);
    review();
    submit("Criar etiqueta");
    const documentInput = field("CPF do destinatário");
    const invoiceInput = field(/^Chave da nota fiscal/);
    view.unmount();
    expect(documentInput.value).toBe("");
    expect(invoiceInput.value).toBe("");
    await act(async () => pending.reject(new Error("secret")));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("Recovery label form", () => {
  it("requires an existing provider UUID and never submits automatically", () => {
    const onSubmit = vi.fn();
    render(
      <RecoveryLabelForm
        busy={false}
        isCurrentSession={current}
        onSubmit={onSubmit}
      />,
    );
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/Não invente um código/)).toBeTruthy();
    fireEvent.change(field("ID da etiqueta no Melhor Envio"), {
      target: { value: "01" },
    });
    submit("Recuperar etiqueta");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(
      field("ID da etiqueta no Melhor Envio").getAttribute("aria-invalid"),
    ).toBe("true");
  });

  it("normalizes the real ID only after explicit submission", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <RecoveryLabelForm
        busy={false}
        isCurrentSession={current}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.change(field("ID da etiqueta no Melhor Envio"), {
      target: { value: ` ${remoteId} ` },
    });
    expect(onSubmit).not.toHaveBeenCalled();
    submit("Recuperar etiqueta");
    await waitFor(() =>
      expect(field("ID da etiqueta no Melhor Envio").value).toBe(""),
    );
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith(remoteId.toLowerCase());
  });

  it("blocks duplicate recovery while pending and sanitizes errors", async () => {
    const pending = deferred();
    const onSubmit = vi.fn().mockReturnValue(pending.promise);
    render(
      <RecoveryLabelForm
        busy={false}
        isCurrentSession={current}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.change(field("ID da etiqueta no Melhor Envio"), {
      target: { value: remoteId },
    });
    submit("Recuperar etiqueta");
    submit("Recuperar etiqueta");
    expect(onSubmit).toHaveBeenCalledOnce();
    await act(async () => pending.reject(new Error("Bearer private-token")));
    expect(screen.getByRole("alert").textContent).toMatch(/Consulte o envio/);
    expect(document.body.textContent).not.toContain("private-token");
    expect(field("ID da etiqueta no Melhor Envio").value).toBe("");
  });

  it("does not recover under a stale session", () => {
    const onSubmit = vi.fn();
    render(
      <RecoveryLabelForm
        busy={false}
        isCurrentSession={() => false}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.change(field("ID da etiqueta no Melhor Envio"), {
      target: { value: remoteId },
    });
    submit("Recuperar etiqueta");
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("Label checkout form", () => {
  it("explains sandbox and requires explicit authorization before buying", () => {
    const onSubmit = vi.fn();
    render(
      <LabelCheckoutForm
        busy={false}
        cost="12.68"
        provider="melhorenvio:sandbox"
        isCurrentSession={current}
        onSubmit={onSubmit}
      />,
    );
    expect(screen.getByText(/Sandbox: etiqueta de teste/)).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>("checkbox").checked).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();
    submit("Comprar etiqueta");
    expect(
      screen.getByText("Autorize o valor antes de comprar a etiqueta."),
    ).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("warns about real production balance and sends the exact expected cost string", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <LabelCheckoutForm
        busy={false}
        cost="1234567890.01"
        provider="melhorenvio:production"
        isCurrentSession={current}
        onSubmit={onSubmit}
      />,
    );
    expect(
      screen.getByText(/Produção: esta compra utiliza saldo real/),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /Autorizo a compra desta etiqueta.*saldo real/,
      }),
    );
    submit("Comprar etiqueta");
    await waitFor(() =>
      expect(screen.getByRole<HTMLInputElement>("checkbox").checked).toBe(
        false,
      ),
    );
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith("1234567890.01");
  });

  it.each(["", "0.00", "12,68", "12.680", "-1.00", "NaN"])(
    "blocks invalid provider cost %j",
    (cost) => {
      const onSubmit = vi.fn();
      render(
        <LabelCheckoutForm
          busy={false}
          cost={cost}
          provider="melhorenvio:sandbox"
          isCurrentSession={current}
          onSubmit={onSubmit}
        />,
      );
      expect(
        screen.getByRole<HTMLButtonElement>("button", {
          name: "Comprar etiqueta",
        }).disabled,
      ).toBe(true);
      submit("Comprar etiqueta");
      expect(onSubmit).not.toHaveBeenCalled();
      expect(screen.getByRole("alert").textContent).toMatch(
        /Valor da etiqueta inválido/,
      );
    },
  );

  it("blocks unknown provider environments", () => {
    const onSubmit = vi.fn();
    render(
      <LabelCheckoutForm
        busy={false}
        cost="12.68"
        provider="melhorenvio:other"
        isCurrentSession={current}
        onSubmit={onSubmit}
      />,
    );
    submit("Comprar etiqueta");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(
      /Ambiente.*não reconhecido/,
    );
  });

  it("invalidates authorization for each cost or provider change, including a return to the old cost", () => {
    const onSubmit = vi.fn();
    const props = {
      busy: false,
      cost: "12.68",
      provider: "melhorenvio:sandbox",
      isCurrentSession: current,
      onSubmit,
    };
    const view = render(<LabelCheckoutForm {...props} />);
    fireEvent.click(screen.getByRole("checkbox"));
    view.rerender(<LabelCheckoutForm {...props} cost="13.00" />);
    expect(screen.getByRole<HTMLInputElement>("checkbox").checked).toBe(false);
    view.rerender(<LabelCheckoutForm {...props} />);
    expect(screen.getByRole<HTMLInputElement>("checkbox").checked).toBe(false);
    fireEvent.click(screen.getByRole("checkbox"));
    view.rerender(
      <LabelCheckoutForm {...props} provider="melhorenvio:production" />,
    );
    expect(screen.getByRole<HTMLInputElement>("checkbox").checked).toBe(false);
    submit("Comprar etiqueta");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("retains the duplicate request lock even if cost changes during a pending purchase", async () => {
    const pending = deferred();
    const onSubmit = vi.fn().mockReturnValue(pending.promise);
    const props = {
      busy: false,
      cost: "12.68",
      provider: "melhorenvio:sandbox",
      isCurrentSession: current,
      onSubmit,
    };
    const view = render(<LabelCheckoutForm {...props} />);
    fireEvent.click(screen.getByRole("checkbox"));
    submit("Comprar etiqueta");
    submit("Comprar etiqueta");
    view.rerender(<LabelCheckoutForm {...props} cost="13.00" />);
    submit("Comprar etiqueta");
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith("12.68");
    await act(async () => pending.resolve());
    expect(screen.getByRole<HTMLInputElement>("checkbox").checked).toBe(false);
  });

  it("does not expose caller secrets or keep authorization after a rejected purchase", async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValue(new Error("X-Api-Key: secret-token"));
    render(
      <LabelCheckoutForm
        busy={false}
        cost="12.68"
        provider="melhorenvio:sandbox"
        isCurrentSession={current}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox"));
    submit("Comprar etiqueta");
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(
        /Consulte a etiqueta/,
      ),
    );
    expect(document.body.textContent).not.toContain("secret-token");
    expect(screen.getByRole<HTMLInputElement>("checkbox").checked).toBe(false);
  });

  it("never buys on a stale session or while the parent is busy", () => {
    const onSubmit = vi.fn();
    let active = true;
    const props = {
      busy: false,
      cost: "12.68",
      provider: "melhorenvio:sandbox",
      isCurrentSession: () => active,
      onSubmit,
    };
    const view = render(<LabelCheckoutForm {...props} />);
    fireEvent.click(screen.getByRole("checkbox"));
    active = false;
    submit("Comprar etiqueta");
    active = true;
    view.rerender(<LabelCheckoutForm {...props} busy />);
    submit("Comprar etiqueta");
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
