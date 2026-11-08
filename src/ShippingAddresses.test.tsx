// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { AddressPicker } from "./ShippingAddresses";
import type { Address } from "./ShippingAddresses";
import { authorized } from "./session";

vi.mock("./session", () => ({ authorized: vi.fn() }));

const address: Address = {
  id: "address-1",
  label: "Casa",
  recipientName: "Pessoa de teste",
  zipCode: "78556858",
  street: "Rua de teste",
  number: "10",
  complement: null,
  neighborhood: "Centro",
  city: "Sinop",
  state: "MT",
  isDefault: true,
  createdAt: "2026-10-22T00:00:00.000Z",
  updatedAt: "2026-10-22T00:00:00.000Z",
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup(
  options: {
    onChange?: (id: string) => void;
    isCurrentSession?: () => boolean;
    onBusyChange?: (busy: boolean) => void;
    disabled?: boolean;
  } = {},
) {
  const onChange = options.onChange ?? vi.fn();
  const onBusyChange = options.onBusyChange ?? vi.fn();
  function Wrapper() {
    const [value, setValue] = useState("");
    return (
      <AddressPicker
        value={value}
        onChange={(id) => {
          setValue(id);
          onChange(id);
        }}
        disabled={options.disabled ?? false}
        isCurrentSession={options.isCurrentSession ?? (() => true)}
        onBusyChange={onBusyChange}
      />
    );
  }
  return { ...render(<Wrapper />), onChange, onBusyChange };
}
async function openForm() {
  const create = await screen.findByRole<HTMLButtonElement>("button", {
    name: "Cadastrar endereço",
  });
  await waitFor(() => expect(create.disabled).toBe(false));
  fireEvent.click(create);
  const fields = {
    "Identificação (opcional)": "  Trabalho  ",
    "Nome do destinatário": "  Pessoa de teste  ",
    CEP: "78556-858",
    "Rua ou avenida": "  Rua de teste  ",
    Número: "  15  ",
    "Complemento (opcional)": "   ",
    Bairro: "  Centro  ",
    Cidade: "  Sinop  ",
    Estado: "MT",
  };
  for (const [label, value] of Object.entries(fields))
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByLabelText("Usar como endereço principal"));
}
function submit() {
  fireEvent.submit(
    screen.getByRole("button", { name: "Salvar endereço" }).closest("form")!,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(authorized).mockResolvedValue([address]);
});
afterEach(cleanup);

describe("Delivery addresses", () => {
  it("loads the API array, selects its default and previews the complete address", async () => {
    const { onChange } = setup();
    await screen.findByText("Pessoa de teste", { selector: "strong" });
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith(address.id);
    expect(
      screen.getByLabelText<HTMLSelectElement>("Endereço de entrega").value,
    ).toBe(address.id);
    expect(screen.getByText(/CEP 78556-858/)).toBeTruthy();
    expect(authorized).toHaveBeenCalledWith("/addresses", {
      signal: expect.any(AbortSignal),
    });
  });
  it("does not repeatedly select a default when refreshing addresses", async () => {
    const onChange = vi.fn();
    render(
      <AddressPicker
        value=""
        onChange={onChange}
        disabled={false}
        isCurrentSession={() => true}
        onBusyChange={() => {}}
      />,
    );
    await waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByText("Atualizar endereços"));
    await waitFor(() => expect(authorized).toHaveBeenCalledTimes(2));
    expect(onChange).toHaveBeenCalledOnce();
  });
  it("posts a normalized address only after submission and selects the confirmed response", async () => {
    const created = {
      ...address,
      id: "address-2",
      label: "Trabalho",
      number: "15",
    };
    const post = deferred<Address>();
    vi.mocked(authorized).mockImplementation((_, init) =>
      init?.method === "POST"
        ? (post.promise as never)
        : (Promise.resolve([]) as never),
    );
    const { onChange, onBusyChange } = setup();
    await openForm();
    expect(authorized).toHaveBeenCalledTimes(1);
    submit();
    expect(onBusyChange).toHaveBeenCalledWith(true);
    expect(onChange).not.toHaveBeenCalled();
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Cancelar cadastro",
      }).disabled,
    ).toBe(true);
    expect(authorized).toHaveBeenLastCalledWith("/addresses", {
      method: "POST",
      body: JSON.stringify({
        label: "Trabalho",
        recipientName: "Pessoa de teste",
        zipCode: "78556858",
        street: "Rua de teste",
        number: "15",
        complement: null,
        neighborhood: "Centro",
        city: "Sinop",
        state: "MT",
        isDefault: true,
      }),
    });
    await act(async () => {
      post.resolve(created);
    });
    expect(onChange).toHaveBeenCalledWith("address-2");
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByText("Novo endereço")).toBeNull();
  });
  it("blocks automatic or manual duplicate POST retries until addresses are reviewed", async () => {
    vi.mocked(authorized).mockImplementation((_, init) =>
      init?.method === "POST"
        ? Promise.reject(new TypeError("Failed to fetch"))
        : (Promise.resolve([]) as never),
    );
    setup();
    await openForm();
    submit();
    await screen.findByText(/Não foi possível confirmar o cadastro/);
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Salvar endereço" })
        .disabled,
    ).toBe(true);
    submit();
    expect(
      vi
        .mocked(authorized)
        .mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(1);
    fireEvent.click(screen.getByText("Atualizar endereços"));
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", {
          name: "Salvar endereço",
        }).disabled,
      ).toBe(false),
    );
    expect(
      vi
        .mocked(authorized)
        .mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(1);
  });
  it("aborts a pending address read and ignores its late response after unmount", async () => {
    const read = deferred<Address[]>();
    vi.mocked(authorized).mockReturnValue(read.promise);
    const { unmount, onChange } = setup();
    await waitFor(() => expect(authorized).toHaveBeenCalledOnce());
    const signal = vi.mocked(authorized).mock.calls[0][1]?.signal;
    unmount();
    await act(async () => {
      read.resolve([address]);
    });
    expect(signal?.aborted).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });
  it("does not post if the session has already changed", async () => {
    let valid = true;
    setup({ isCurrentSession: () => valid });
    await openForm();
    valid = false;
    submit();
    expect(
      vi
        .mocked(authorized)
        .mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(0);
  });
  it("ignores a successful POST response from a previous session", async () => {
    let valid = true;
    const post = deferred<Address>();
    vi.mocked(authorized).mockImplementation((_, init) =>
      init?.method === "POST"
        ? (post.promise as never)
        : (Promise.resolve([]) as never),
    );
    const { onChange } = setup({ isCurrentSession: () => valid });
    await openForm();
    submit();
    valid = false;
    await act(async () => {
      post.resolve(address);
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByText("Endereço cadastrado e selecionado.")).toBeNull();
  });
});
