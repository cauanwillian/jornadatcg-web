// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AddressesArea } from "./AddressesArea";
import { authorized } from "./session";
import type { Address, AddressInput } from "./ShippingAddresses";

vi.mock("./session", () => ({ authorized: vi.fn() }));
const firstId = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";
const createdId = "33333333-3333-4333-8333-333333333333";
const timestamp = "2026-10-24T12:00:00.000Z";
const current = () => true;
const noop = () => {};
function address(id = firstId, label = "Casa", isDefault = true): Address {
  return {
    id,
    label,
    recipientName: "Cliente de demonstração",
    zipCode: "78000000",
    street: "Rua de demonstração",
    number: "100",
    complement: null,
    neighborhood: "Centro",
    city: "Cuiabá",
    state: "MT",
    isDefault,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
const copy = <T,>(value: T): T => structuredClone(value);
let records: Address[];
let readFailure: unknown;
let detailFailure: unknown;
let writeFailure: unknown;
let afterWriteReadFailure: unknown;
let wrote: boolean;
function apiError(status: number) {
  return Object.assign(new Error("RAW_SECRET_INTERNAL"), { status });
}
async function server(path: string, options: RequestInit = {}) {
  const method = options.method ?? "GET";
  if (path === "/addresses" && method === "GET") {
    if (readFailure) throw readFailure;
    if (wrote && afterWriteReadFailure) throw afterWriteReadFailure;
    return copy(records);
  }
  const id = path.split("/").at(-1)!;
  if (method === "GET") {
    if (detailFailure) throw detailFailure;
    const found = records.find((record) => record.id === id);
    if (!found) throw apiError(404);
    return copy(found);
  }
  if (writeFailure) throw writeFailure;
  wrote = true;
  if (method === "DELETE") {
    const wasDefault = records.find((record) => record.id === id)?.isDefault;
    records = records.filter((record) => record.id !== id);
    if (wasDefault && records.length) records[0].isDefault = true;
    return undefined;
  }
  const input = JSON.parse(String(options.body)) as AddressInput;
  if (input.isDefault)
    records = records.map((record) => ({ ...record, isDefault: false }));
  if (method === "POST") {
    const saved = {
      ...input,
      id: createdId,
      isDefault: records.length === 0 || input.isDefault === true,
      createdAt: timestamp,
      updatedAt: timestamp,
    } as Address;
    records.push(saved);
    return copy(saved);
  }
  const index = records.findIndex((record) => record.id === id);
  if (index < 0) throw apiError(404);
  records[index] = {
    ...records[index],
    ...input,
    updatedAt: "2026-10-24T13:00:00.000Z",
  };
  return copy(records[index]);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.mocked(authorized).mockReset();
  records = [address(), address(secondId, "Trabalho", false)];
  readFailure =
    detailFailure =
    writeFailure =
    afterWriteReadFailure =
      undefined;
  wrote = false;
  vi.mocked(authorized).mockImplementation(server);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
async function view(props: Partial<Parameters<typeof AddressesArea>[0]> = {}) {
  const result = render(
    <AddressesArea isCurrentSession={current} onBusyChange={noop} {...props} />,
  );
  await waitFor(() =>
    expect(screen.queryByText("Carregando endereços…")).toBeNull(),
  );
  return result;
}
async function edit(id = firstId) {
  const address = records.find((record) => record.id === id)!;
  fireEvent.click(
    screen.getByRole("button", {
      name: `Editar endereço ${address.label || address.recipientName}, ${address.street}, ${address.number}`,
    }),
  );
  await screen.findByRole("form", { name: "Editar endereço" });
}
function fillNew() {
  const values: Record<string, string> = {
    "Identificação (opcional)": "Novo",
    "Nome do destinatário": "Outra pessoa demonstrativa",
    CEP: "78000-000",
    "Rua ou avenida": "Rua Nova",
    Número: "20",
    Bairro: "Centro",
    Cidade: "Cuiabá",
  };
  for (const [name, value] of Object.entries(values))
    fireEvent.change(screen.getByLabelText(name), { target: { value } });
  fireEvent.change(screen.getByLabelText("Estado"), {
    target: { value: "MT" },
  });
}
function writes() {
  return vi
    .mocked(authorized)
    .mock.calls.filter(([, options]) => options?.method !== "GET");
}

describe("AddressesArea", () => {
  it("lists the authenticated array, marks the principal and does not write", async () => {
    await view();
    expect(screen.getByRole("heading", { name: "Casa" })).toBeTruthy();
    expect(screen.getByText("Principal")).toBeTruthy();
    expect(
      screen.getByText(/não modificam envios já solicitados/),
    ).toBeTruthy();
    expect(authorized).toHaveBeenCalledWith(
      "/addresses",
      expect.objectContaining({ method: "GET", cache: "no-store" }),
    );
    expect(writes()).toHaveLength(0);
  });
  it("shows an empty state and registers only after an explicit valid submit", async () => {
    records = [];
    await view();
    expect(screen.getByText(/ainda não tem endereços salvos/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar endereço" }));
    fillNew();
    expect(writes()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Salvar endereço" }));
    await screen.findByText("Endereço cadastrado.");
    expect(writes()).toHaveLength(1);
    expect(writes()[0][0]).toBe("/addresses");
    expect(writes()[0][1]?.method).toBe("POST");
    expect(screen.getByText("Principal")).toBeTruthy();
    expect(screen.queryByRole("form")).toBeNull();
    expect(
      vi
        .mocked(authorized)
        .mock.calls.filter(([path]) => path === "/addresses"),
    ).toHaveLength(3);
  });
  it("fetches the current record before editing and sends a complete PUT without metadata", async () => {
    await view();
    await edit();
    expect(authorized).toHaveBeenCalledWith(
      `/addresses/${firstId}`,
      expect.objectContaining({ method: "GET" }),
    );
    fireEvent.change(screen.getByLabelText("Rua ou avenida"), {
      target: { value: "Rua Editada" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar endereço" }));
    await screen.findByText("Endereço atualizado.");
    expect(writes()).toHaveLength(1);
    const [path, options] = writes()[0];
    expect(path).toBe(`/addresses/${firstId}`);
    expect(options?.method).toBe("PUT");
    const body = JSON.parse(String(options?.body));
    expect(body.street).toBe("Rua Editada");
    expect(body.recipientName).toBe("Cliente de demonstração");
    expect(body.isDefault).toBe(true);
    expect(body.id).toBeUndefined();
    expect(body.updatedAt).toBeUndefined();
    expect(screen.getByText(/Rua Editada/)).toBeTruthy();
  });
  it("keeps the existing principal checked and can choose another through edit", async () => {
    await view();
    await edit();
    expect(
      (
        screen.getByLabelText(
          "Usar como endereço principal",
        ) as HTMLInputElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar edição" }));
    await edit(secondId);
    fireEvent.click(screen.getByLabelText("Usar como endereço principal"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar endereço" }));
    await screen.findByText("Endereço atualizado.");
    expect(records.find((record) => record.id === secondId)?.isDefault).toBe(
      true,
    );
    expect(screen.getAllByText("Principal")).toHaveLength(1);
  });
  it("cancels editing without saving or retaining the draft", async () => {
    await view();
    await edit();
    fireEvent.change(screen.getByLabelText("Nome do destinatário"), {
      target: { value: "Rascunho" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar edição" }));
    expect(writes()).toHaveLength(0);
    await edit();
    expect(
      (screen.getByLabelText("Nome do destinatário") as HTMLInputElement).value,
    ).toBe("Cliente de demonstração");
  });
  it("requires a fresh detail and explicit removal, then reloads the promoted principal", async () => {
    await view();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Remover endereço Casa, Rua de demonstração, 100",
      }),
    );
    await screen.findByRole("heading", { name: "Remover endereço" });
    expect(writes()).toHaveLength(0);
    expect(
      screen.getByText(/endereço restante salvo há mais tempo/),
    ).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("heading", { name: "Remover endereço" }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirmar remoção" }));
    await screen.findByText(
      "Endereço removido. Confira o endereço principal na lista atualizada.",
    );
    expect(writes()[0][1]?.method).toBe("DELETE");
    expect(writes()[0][1]?.body).toBeUndefined();
    expect(screen.queryByRole("heading", { name: "Casa" })).toBeNull();
    expect(screen.getByText("Principal")).toBeTruthy();
  });
  it("allows cancelling removal without sending DELETE", async () => {
    await view();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Remover endereço Casa, Rua de demonstração, 100",
      }),
    );
    await screen.findByRole("button", { name: "Confirmar remoção" });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar remoção" }));
    expect(writes()).toHaveLength(0);
    expect(screen.getByRole("heading", { name: "Casa" })).toBeTruthy();
  });
  it("blocks operations after 409 until the user refreshes the canonical list", async () => {
    await view();
    await edit();
    writeFailure = apiError(409);
    fireEvent.click(screen.getByRole("button", { name: "Salvar endereço" }));
    await screen.findByRole("alert");
    expect(screen.queryByText(/RAW_SECRET_INTERNAL/)).toBeNull();
    expect(
      (
        screen.getByRole("button", {
          name: "Cadastrar endereço",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    writeFailure = undefined;
    fireEvent.click(
      screen.getByRole("button", { name: "Atualizar endereços" }),
    );
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Cadastrar endereço",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    expect(writes()).toHaveLength(1);
  });
  it("requires refreshing and an explicit review before allowing a new uncertain POST", async () => {
    await view();
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar endereço" }));
    fillNew();
    writeFailure = new TypeError("RAW_SECRET_INTERNAL");
    fireEvent.click(screen.getByRole("button", { name: "Salvar endereço" }));
    await screen.findByRole("alert");
    expect(
      screen.getByLabelText("Conferência de cadastro incerto"),
    ).toBeTruthy();
    expect(screen.queryByRole("form")).toBeNull();
    writeFailure = undefined;
    fireEvent.click(
      screen.getByRole("button", { name: "Atualizar endereços" }),
    );
    const confirm = await screen.findByRole("button", {
      name: "Liberar novo cadastro",
    });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Cadastrar endereço",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(
      screen.getByLabelText(
        "Conferi a lista e o endereço que desejo cadastrar ainda não existe",
      ),
    );
    fireEvent.click(confirm);
    expect(
      (
        screen.getByRole("button", {
          name: "Cadastrar endereço",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(writes()).toHaveLength(1);
  });
  it("blocks writes when a confirmed mutation cannot be followed by a list read", async () => {
    await view();
    await edit();
    afterWriteReadFailure = new Error("RAW_SECRET_INTERNAL");
    fireEvent.click(screen.getByRole("button", { name: "Salvar endereço" }));
    await screen.findByText(/A alteração foi recebida/);
    expect(screen.queryByRole("form")).toBeNull();
    expect(
      (
        screen.getByRole("button", {
          name: "Cadastrar endereço",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    afterWriteReadFailure = undefined;
    fireEvent.click(
      screen.getByRole("button", { name: "Atualizar endereços" }),
    );
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Cadastrar endereço",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    expect(writes()).toHaveLength(1);
  });
  it("clears private addresses and forms after access is denied", async () => {
    await view();
    detailFailure = apiError(403);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Editar endereço Casa, Rua de demonstração, 100",
      }),
    );
    await screen.findByRole("alert");
    expect(screen.queryByText("Cliente de demonstração")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Casa" })).toBeNull();
    expect(screen.queryByText(/RAW_SECRET_INTERNAL/)).toBeNull();
  });
  it("does not apply old detail responses after their consultation is cancelled", async () => {
    const pending = deferred<Address>();
    await view();
    vi.mocked(authorized).mockImplementation(async (path, options) =>
      path === `/addresses/${firstId}`
        ? pending.promise
        : server(path, options),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Editar endereço Casa, Rua de demonstração, 100",
      }),
    );
    await screen.findByText("Consultando endereço…");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar consulta" }));
    await act(async () => pending.resolve(address()));
    expect(screen.queryByRole("form")).toBeNull();
    expect(screen.getByRole("heading", { name: "Casa" })).toBeTruthy();
  });
  it("prevents duplicate submissions and keeps the parent locked through the refresh", async () => {
    const pending = deferred<Address>();
    const onBusyChange = vi.fn();
    await view({ onBusyChange });
    await edit();
    vi.mocked(authorized).mockImplementation(async (path, options) =>
      options?.method === "PUT" ? pending.promise : server(path, options),
    );
    const form = screen.getByRole("form");
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(writes()).toHaveLength(1);
    expect(onBusyChange).toHaveBeenCalledWith(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Cancelar edição",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await act(async () => pending.resolve(address()));
    await screen.findByText("Endereço atualizado.");
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });
  it("aborts a pending write on unmount and makes no follow-up GET from its late response", async () => {
    const pending = deferred<Address>();
    const onBusyChange = vi.fn();
    const rendered = await view({ onBusyChange });
    await edit();
    vi.mocked(authorized).mockImplementation(async (path, options) =>
      options?.method === "PUT" ? pending.promise : server(path, options),
    );
    fireEvent.click(screen.getByRole("button", { name: "Salvar endereço" }));
    const signal = writes()[0][1]!.signal!;
    rendered.unmount();
    const calls = vi.mocked(authorized).mock.calls.length;
    expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve(address()));
    expect(authorized).toHaveBeenCalledTimes(calls);
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });
  it("discards private results after the session ceases to be current", async () => {
    const pending = deferred<Address>();
    let valid = true;
    const rendered = await view({ isCurrentSession: () => valid });
    vi.mocked(authorized).mockImplementation(async (path, options) =>
      path === `/addresses/${firstId}`
        ? pending.promise
        : server(path, options),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Editar endereço Casa, Rua de demonstração, 100",
      }),
    );
    valid = false;
    rendered.rerender(
      <AddressesArea isCurrentSession={() => valid} onBusyChange={noop} />,
    );
    await act(async () => pending.resolve(address()));
    expect(screen.queryByLabelText("Meus endereços")).toBeNull();
    expect(writes()).toHaveLength(0);
  });
  it("releases the mutation lock after a timeout even when the API mock ignores abort", async () => {
    const onBusyChange = vi.fn();
    await view({ onBusyChange });
    await edit();
    vi.useFakeTimers();
    vi.mocked(authorized).mockImplementation(async (path, options) =>
      options?.method === "PUT" ? new Promise(() => {}) : server(path, options),
    );
    fireEvent.click(screen.getByRole("button", { name: "Salvar endereço" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15001);
    });
    expect(screen.getByRole("alert").textContent).toContain(
      "pode ter sido concluída",
    );
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
    expect(
      (
        screen.getByRole("button", {
          name: "Atualizar endereços",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(writes()).toHaveLength(1);
  });
  it("does not enable a new record beyond the backend limit", async () => {
    records = Array.from({ length: 20 }, (_, index) =>
      address(
        `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        `Local ${index + 1}`,
        index === 0,
      ),
    );
    await view();
    expect(
      (
        screen.getByRole("button", {
          name: "Cadastrar endereço",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(screen.getByText(/atingiu o limite de 20 endereços/)).toBeTruthy();
    expect(writes()).toHaveLength(0);
  });
  it("can retry a failed initial list read without exposing internal details", async () => {
    readFailure = new TypeError("RAW_SECRET_INTERNAL");
    await view();
    expect(screen.getByRole("alert").textContent).not.toContain(
      "RAW_SECRET_INTERNAL",
    );
    readFailure = undefined;
    fireEvent.click(
      screen.getByRole("button", { name: "Atualizar endereços" }),
    );
    await screen.findByRole("heading", { name: "Casa" });
    expect(writes()).toHaveLength(0);
  });
});
