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
import { Registration } from "./RegistrationForm";
import { registerCustomer, RegistrationError } from "./registration";

vi.mock("./registration", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./registration")>()),
  registerCustomer: vi.fn(),
}));

const credentials = {
  name: "  Pessoa de teste  ",
  email: "  PESSOA@EXAMPLE.COM  ",
  password: "Senha de teste 123!",
};
const customer: Awaited<ReturnType<typeof registerCustomer>> = {
  id: "2af57a4c-c849-4915-a138-b6c4543d322d",
  name: "Pessoa de teste",
  email: "pessoa@example.com",
  role: "CUSTOMER",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function setup() {
  const onLogin = vi.fn();
  const onBusyChange = vi.fn();
  return {
    ...render(
      <Registration onLogin={onLogin} onBusyChange={onBusyChange} />,
    ),
    onLogin,
    onBusyChange,
  };
}

function field(name: string) {
  return screen.getByLabelText<HTMLInputElement>(name);
}

function fill(
  values: Partial<{
    name: string;
    email: string;
    password: string;
    confirmation: string;
  }> = {},
) {
  const input = {
    ...credentials,
    confirmation: credentials.password,
    ...values,
  };
  for (const [label, value] of Object.entries({
    Nome: input.name,
    "E-mail": input.email,
    Senha: input.password,
    "Confirmar senha": input.confirmation,
  }))
    fireEvent.change(field(label), { target: { value } });
}

function submit() {
  fireEvent.submit(field("Nome").closest("form")!);
}

function expectFieldError(label: string) {
  const input = field(label);
  expect(input.getAttribute("aria-invalid")).toBe("true");
  const descriptions = input.getAttribute("aria-describedby")?.split(/\s+/);
  expect(descriptions?.length).toBeGreaterThan(0);
  expect(
    descriptions?.some((id) => document.getElementById(id)?.textContent?.trim()),
  ).toBe(true);
}

function expectPasswordsCleared() {
  expect(field("Senha").value).toBe("");
  expect(field("Confirmar senha").value).toBe("");
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(registerCustomer).mockResolvedValue(customer);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Customer registration", () => {
  it("shows accessible fields without submitting on mount", () => {
    setup();
    for (const name of ["Nome", "E-mail", "Senha", "Confirmar senha"])
      expect(field(name)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Criar conta" }).closest("form")!
        .noValidate,
    ).toBe(true);
    expect(registerCustomer).not.toHaveBeenCalled();
  });

  it("associates required field errors without contacting the API", () => {
    setup();
    submit();
    for (const name of ["Nome", "E-mail", "Senha", "Confirmar senha"])
      expectFieldError(name);
    expect(registerCustomer).not.toHaveBeenCalled();
  });

  it.each([
    { label: "Nome", values: { name: "   " } },
    { label: "Nome", values: { name: "a".repeat(121) } },
    { label: "E-mail", values: { email: "email-invalido" } },
    {
      label: "E-mail",
      values: { email: `${"a".repeat(243)}@example.com` },
    },
    {
      label: "Senha",
      values: { password: "12345678901", confirmation: "12345678901" },
    },
    {
      label: "Senha",
      values: { password: "a".repeat(129), confirmation: "a".repeat(129) },
    },
    {
      label: "Confirmar senha",
      values: { confirmation: "Outra senha 123!" },
    },
  ])("rejects invalid $label before submitting ($values)", ({ label, values }) => {
    setup();
    fill(values);
    submit();
    expectFieldError(label);
    expect(registerCustomer).not.toHaveBeenCalled();
  });

  it("sends only the registration credentials and returns to login with the confirmed email", async () => {
    const { onLogin, onBusyChange } = setup();
    fill();
    submit();
    await waitFor(() => expect(onLogin).toHaveBeenCalledOnce());
    expect(vi.mocked(registerCustomer).mock.calls[0][0]).toEqual({
      ...credentials,
      email: credentials.email.trim(),
    });
    expect(onLogin).toHaveBeenCalledWith("pessoa@example.com", true);
    expect(onBusyChange).toHaveBeenCalledWith(true);
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
    expectPasswordsCleared();
  });

  it("blocks duplicate submissions and login navigation while a request is pending", async () => {
    const post = deferred<typeof customer>();
    vi.mocked(registerCustomer).mockReturnValue(post.promise);
    const { onLogin, onBusyChange } = setup();
    fill();
    submit();
    submit();
    expect(registerCustomer).toHaveBeenCalledOnce();
    expect(onBusyChange.mock.calls.filter(([busy]) => busy)).toHaveLength(1);
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Já tenho conta" })
        .disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Já tenho conta" }));
    expect(onLogin).not.toHaveBeenCalled();
    await act(async () => post.resolve(customer));
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
    expect(onLogin).toHaveBeenCalledWith("pessoa@example.com", true);
  });

  it("preserves name and email after a conflicting account while clearing passwords", async () => {
    vi.mocked(registerCustomer).mockRejectedValue(
      new RegistrationError("conflict", "Este e-mail já está cadastrado."),
    );
    const { onLogin, onBusyChange } = setup();
    fill();
    submit();
    await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
    expect(field("Nome").value.trim()).toBe("Pessoa de teste");
    expect(field("E-mail").value.trim().toLowerCase()).toBe("pessoa@example.com");
    expectPasswordsCleared();
    expect(onLogin).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain(
      "Este e-mail já está cadastrado.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Já tenho conta" }));
    expect(onLogin).toHaveBeenCalledWith("pessoa@example.com", false);
  });

  it("requires explicit review before another attempt after an uncertain response", async () => {
    vi.mocked(registerCustomer).mockRejectedValueOnce(
      new RegistrationError("uncertain", "Não foi possível confirmar o cadastro."),
    );
    const { onBusyChange } = setup();
    fill();
    submit();
    await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
    expectPasswordsCleared();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Criar conta" })
        .disabled,
    ).toBe(true);
    submit();
    expect(registerCustomer).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Revisar cadastro" }));
    expect(registerCustomer).toHaveBeenCalledOnce();
    fill();
    submit();
    await waitFor(() => expect(registerCustomer).toHaveBeenCalledTimes(2));
  });

  it("allows login with the same email when registration could not be confirmed", async () => {
    vi.mocked(registerCustomer).mockRejectedValueOnce(
      new RegistrationError("uncertain", "Não foi possível confirmar o cadastro."),
    );
    const { onLogin, onBusyChange } = setup();
    fill();
    submit();
    await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
    fireEvent.click(screen.getByRole("button", { name: "Tentar entrar" }));
    expect(onLogin).toHaveBeenCalledWith("pessoa@example.com", false);
    expect(registerCustomer).toHaveBeenCalledOnce();
  });

  it("waits for the supplied retry deadline before accepting another explicit submission", async () => {
    vi.useFakeTimers();
    vi.mocked(registerCustomer).mockRejectedValueOnce(
      new RegistrationError(
        "rate-limit",
        "Muitas tentativas de cadastro.",
        Date.now() + 3_000,
      ),
    );
    setup();
    fill();
    await act(async () => submit());
    expectPasswordsCleared();
    const create = () =>
      screen.getByRole<HTMLButtonElement>("button", { name: "Criar conta" });
    expect(create().disabled).toBe(true);
    submit();
    await act(async () => vi.advanceTimersByTime(2_000));
    expect(create().disabled).toBe(true);
    expect(registerCustomer).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(create().disabled).toBe(false);
    expect(registerCustomer).toHaveBeenCalledOnce();
    fill();
    await act(async () => submit());
    expect(registerCustomer).toHaveBeenCalledTimes(2);
  });

  it("treats unexpected errors as uncertain without exposing their internal message", async () => {
    vi.mocked(registerCustomer).mockRejectedValueOnce(
      new TypeError("internal-secret-placeholder"),
    );
    const { onBusyChange } = setup();
    fill();
    submit();
    await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
    expect(screen.getByRole("alert").textContent).not.toContain(
      "internal-secret-placeholder",
    );
    expect(screen.getByRole("button", { name: "Revisar cadastro" })).toBeTruthy();
    expectPasswordsCleared();
  });

  it("aborts a pending request and ignores its late success after unmount", async () => {
    const post = deferred<typeof customer>();
    vi.mocked(registerCustomer).mockReturnValue(post.promise);
    const { unmount, onLogin, onBusyChange } = setup();
    fill();
    submit();
    const call = vi.mocked(registerCustomer).mock.calls[0];
    const signal = call[1];
    expect(signal).toBeInstanceOf(AbortSignal);
    unmount();
    expect(signal?.aborted).toBe(true);
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
    await act(async () => post.resolve(customer));
    expect(onLogin).not.toHaveBeenCalled();
  });

  it("returns to login with the normalized email without creating an account", () => {
    const { onLogin } = setup();
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Já tenho conta" }));
    expect(onLogin).toHaveBeenCalledWith("pessoa@example.com", false);
    expect(registerCustomer).not.toHaveBeenCalled();
  });
});
