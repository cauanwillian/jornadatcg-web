// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddressForm } from "./AddressForm";
import type { AddressFormProps } from "./AddressForm";
import type { Address } from "./ShippingAddresses";

const address: Address = {
  id: "11111111-1111-4111-8111-111111111111",
  label: "Casa",
  recipientName: "Pessoa de teste",
  zipCode: "78000000",
  street: "Rua de teste",
  number: "100",
  complement: null,
  neighborhood: "Centro",
  city: "Cuiabá",
  state: "MT",
  isDefault: false,
  createdAt: "2026-10-24T12:00:00.000Z",
  updatedAt: "2026-10-24T12:00:00.000Z",
};
const defaults = () => ({
  busy: false,
  isCurrentSession: () => true,
  onSubmit: vi.fn(async () => {}),
  onCancel: vi.fn(),
});
function setup(props: Partial<AddressFormProps> = {}) {
  const callbacks = { ...defaults(), ...props };
  return { ...render(<AddressForm {...callbacks} />), ...callbacks };
}
function fill() {
  for (const [name, value] of Object.entries({
    "Nome do destinatário": " Pessoa de teste ",
    CEP: "78000-000",
    "Rua ou avenida": " Rua de teste ",
    Número: "s/n",
    Bairro: "Centro",
    Cidade: "Cuiabá",
    Estado: "MT",
  }))
    fireEvent.change(screen.getByLabelText(name), { target: { value } });
}
function submit() {
  fireEvent.submit(
    screen.getByRole("button", { name: "Salvar endereço" }).closest("form")!,
  );
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
describe("AddressForm", () => {
  it("uses associated labels, a native UF select, and does not submit on mount", () => {
    const props = setup();
    expect(screen.getByRole("heading", { name: "Novo endereço" }).tagName).toBe(
      "H3",
    );
    expect(
      screen
        .getByLabelText("Nome do destinatário")
        .getAttribute("autocomplete"),
    ).toBe("name");
    expect(screen.getByLabelText("CEP").getAttribute("inputmode")).toBe(
      "numeric",
    );
    expect(screen.getByLabelText("Estado").tagName).toBe("SELECT");
    expect(document.activeElement).toBe(
      screen.getByLabelText("Identificação (opcional)"),
    );
    expect(props.onSubmit).not.toHaveBeenCalled();
  });
  it("shows accessible field errors without sending invalid data", () => {
    const props = setup();
    submit();
    const field = screen.getByLabelText("Nome do destinatário");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(
      document.getElementById(field.getAttribute("aria-describedby")!)
        ?.textContent,
    ).toContain("Nome do destinatário");
    expect(props.onSubmit).not.toHaveBeenCalled();
  });
  it("submits trimmed values, optional nulls, and an eight-digit zip", async () => {
    const props = setup();
    fill();
    submit();
    await act(async () => {});
    expect(props.onSubmit).toHaveBeenCalledWith({
      label: null,
      recipientName: "Pessoa de teste",
      zipCode: "78000000",
      street: "Rua de teste",
      number: "s/n",
      complement: null,
      neighborhood: "Centro",
      city: "Cuiabá",
      state: "MT",
      isDefault: false,
    });
  });
  it("keeps letters in a zip visible and rejects them rather than silently changing the address", () => {
    const props = setup();
    fill();
    fireEvent.change(screen.getByLabelText("CEP"), {
      target: { value: "78000a00" },
    });
    submit();
    expect((screen.getByLabelText("CEP") as HTMLInputElement).value).toBe(
      "78000a00",
    );
    expect(screen.getByLabelText("CEP").getAttribute("aria-invalid")).toBe(
      "true",
    );
    expect(props.onSubmit).not.toHaveBeenCalled();
  });
  it("preloads edit fields and allows another address to become principal", async () => {
    const props = setup({ initial: address });
    expect(
      screen.getByRole("heading", { name: "Editar endereço" }),
    ).toBeTruthy();
    expect((screen.getByLabelText("CEP") as HTMLInputElement).value).toBe(
      "78000-000",
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Usar como endereço principal" }),
    );
    submit();
    await act(async () => {});
    expect(props.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ isDefault: true }),
    );
  });
  it("does not allow unsetting the current principal", async () => {
    const props = setup({ initial: { ...address, isDefault: true } });
    const check = screen.getByRole("checkbox", {
      name: "Usar como endereço principal",
    }) as HTMLInputElement;
    expect(check.checked).toBe(true);
    expect(check.disabled).toBe(true);
    expect(screen.getByText(/Para mudar, escolha outro endereço/)).toBeTruthy();
    submit();
    await act(async () => {});
    expect(props.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ isDefault: true }),
    );
  });
  it("blocks duplicate submissions, edits and cancel while awaiting the parent", async () => {
    const pending = deferred();
    const props = setup({ onSubmit: vi.fn(() => pending.promise) });
    fill();
    submit();
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Salvando endereço…" })
        .closest("form")!,
    );
    fireEvent.change(screen.getByLabelText("Cidade"), {
      target: { value: "Other" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar cadastro" }));
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
    expect(props.onCancel).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Cidade") as HTMLInputElement).value).toBe(
      "Cuiabá",
    );
    expect(screen.getByLabelText("Cidade").closest("fieldset")?.disabled).toBe(
      true,
    );
    await act(async () => pending.resolve());
    expect(
      (
        screen.getByRole("button", {
          name: "Salvar endereço",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });
  it("honors the external busy flag without issuing another request", () => {
    const props = setup({ initial: address, busy: true });
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Salvando endereço…" })
        .closest("form")!,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancelar edição" }));
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(props.onCancel).not.toHaveBeenCalled();
  });
  it("only cancels through the explicit action and valid session", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar cadastro" }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });
  it("rejects stale-session submits and cancel actions", () => {
    let current = true;
    const props = setup({ initial: address, isCurrentSession: () => current });
    current = false;
    submit();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar edição" }));
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(props.onCancel).not.toHaveBeenCalled();
  });
  it("sanitizes parent failures without exposing addresses or service errors", async () => {
    const props = setup({
      initial: address,
      onSubmit: vi.fn(async () => {
        throw new Error("SECRET_ADDRESS_RAW_FAILURE");
      }),
    });
    submit();
    await act(async () => {});
    expect(screen.getByRole("alert").textContent).toBe(
      "Não foi possível confirmar o endereço. Consulte a lista antes de tentar novamente.",
    );
    expect(screen.queryByText(/SECRET_ADDRESS_RAW_FAILURE/)).toBeNull();
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
  });
  it("discards late failures on unmount or revoked session", async () => {
    const pending = deferred();
    let current = true;
    const props = setup({
      initial: address,
      isCurrentSession: () => current,
      onSubmit: vi.fn(() => pending.promise),
    });
    submit();
    current = false;
    props.unmount();
    await act(async () => pending.reject(new Error("private")));
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("resets private fields when a different address or version is selected", () => {
    const props = defaults();
    const view = render(<AddressForm {...props} initial={address} />);
    fireEvent.change(screen.getByLabelText("Cidade"), {
      target: { value: "Unsaved private city" },
    });
    view.rerender(
      <AddressForm
        {...props}
        initial={{
          ...address,
          city: "Outra cidade",
          updatedAt: "2026-10-24T13:00:00.000Z",
        }}
      />,
    );
    expect((screen.getByLabelText("Cidade") as HTMLInputElement).value).toBe(
      "Outra cidade",
    );
    view.rerender(<AddressForm {...props} />);
    expect((screen.getByLabelText("Cidade") as HTMLInputElement).value).toBe(
      "",
    );
  });
});
