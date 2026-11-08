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
import { ForgotPassword, ResetPassword } from "./PasswordRecovery";
import {
  passwordResetMessage,
  RecoveryError,
  recoveryRequestedMessage,
  requestPasswordReset,
  resetPassword,
} from "./password-recovery";

vi.mock("./password-recovery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./password-recovery")>()),
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
}));
const token = "a".repeat(43);
const password = " nova senha de teste ";
function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function setupForgot() {
  const props = {
    onLogin: vi.fn(),
    onBusyChange: vi.fn(),
    isCurrentSession: vi.fn(() => true),
  };
  return { ...render(<ForgotPassword {...props} />), props };
}
function setupReset(value: string | null = token) {
  const props = {
    token: value,
    onLogin: vi.fn(),
    onBusyChange: vi.fn(),
    onReset: vi.fn(),
    isCurrentSession: vi.fn(() => true),
  };
  return { ...render(<ResetPassword {...props} />), props };
}
const field = (label: string) => screen.getByLabelText<HTMLInputElement>(label);
function submitForgot(email = " Test@EXAMPLE.com ") {
  fireEvent.change(field("E-mail"), { target: { value: email } });
  fireEvent.submit(field("E-mail").closest("form")!);
}
function fillReset(value = password, confirmation = value) {
  fireEvent.change(field("Nova senha"), { target: { value } });
  fireEvent.change(field("Confirmar nova senha"), {
    target: { value: confirmation },
  });
}
function submitReset() {
  fireEvent.submit(field("Nova senha").closest("form")!);
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requestPasswordReset).mockResolvedValue();
  vi.mocked(resetPassword).mockResolvedValue();
  sessionStorage.clear();
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Forgot password", () => {
  it("uses accessible fields, prefills email and sends nothing on mount", () => {
    render(
      <ForgotPassword
        initialEmail="demo@example.com"
        onLogin={vi.fn()}
        onBusyChange={vi.fn()}
      />,
    );
    expect(field("E-mail").value).toBe("demo@example.com");
    expect(field("E-mail").type).toBe("email");
    expect(requestPasswordReset).not.toHaveBeenCalled();
  });
  it("focuses and associates email validation errors without sending", () => {
    setupForgot();
    submitForgot("invalid");
    expect(requestPasswordReset).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(field("E-mail"));
    expect(field("E-mail").getAttribute("aria-invalid")).toBe("true");
    const description = field("E-mail").getAttribute("aria-describedby")!;
    expect(document.getElementById(description)?.textContent).toContain(
      "e-mail válido",
    );
  });
  it("shows the same generic acceptance, without navigating or storing personal data", async () => {
    const { props } = setupForgot();
    submitForgot();
    await screen.findByText(recoveryRequestedMessage);
    expect(requestPasswordReset).toHaveBeenCalledWith(
      "Test@EXAMPLE.com",
      expect.any(AbortController),
    );
    expect(props.onLogin).not.toHaveBeenCalled();
    expect(screen.getByText(/pasta de spam/)).toBeTruthy();
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Voltar para entrar" }));
    expect(props.onLogin).toHaveBeenCalledTimes(1);
  });
  it("blocks duplicate submissions and navigation while sending", async () => {
    const task = deferred();
    vi.mocked(requestPasswordReset).mockReturnValue(task.promise);
    const { props } = setupForgot();
    submitForgot();
    fireEvent.submit(field("E-mail").closest("form")!);
    fireEvent.click(screen.getByRole("button", { name: "Voltar para entrar" }));
    expect(requestPasswordReset).toHaveBeenCalledTimes(1);
    expect(props.onLogin).not.toHaveBeenCalled();
    expect(
      (
        screen.getByRole("button", {
          name: "Enviando solicitação…",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(props.onBusyChange.mock.calls).toEqual([[true]]);
    await act(async () => task.resolve());
    expect(props.onBusyChange.mock.calls).toEqual([[true], [false]]);
  });
  it("shows a fixed unavailable message and does not automatically retry", async () => {
    vi.mocked(requestPasswordReset).mockRejectedValue(
      new RecoveryError(
        "unavailable",
        "A recuperação de senha está temporariamente indisponível. Tente novamente mais tarde.",
      ),
    );
    setupForgot();
    submitForgot();
    await screen.findByRole("alert");
    expect(screen.queryByText(recoveryRequestedMessage)).toBeNull();
    expect(requestPasswordReset).toHaveBeenCalledTimes(1);
  });
  it("waits for Retry-After before allowing another explicit request", async () => {
    vi.useFakeTimers();
    vi.mocked(requestPasswordReset).mockRejectedValue(
      new RecoveryError(
        "rate-limit",
        "Aguarde antes de tentar novamente.",
        Date.now() + 2000,
      ),
    );
    setupForgot();
    await act(async () => submitForgot());
    expect(
      (
        screen.getByRole("button", {
          name: "Enviar link de recuperação",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(screen.getByText(/Aguarde 2 segundos/)).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(
      (
        screen.getByRole("button", {
          name: "Enviar link de recuperação",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(requestPasswordReset).toHaveBeenCalledTimes(1);
  });
  it("aborts on unmount, releases owned busy once and ignores a late completion", async () => {
    const task = deferred();
    vi.mocked(requestPasswordReset).mockReturnValue(task.promise);
    const { props, unmount } = setupForgot();
    submitForgot();
    const controller = vi.mocked(requestPasswordReset).mock.calls[0][1];
    unmount();
    expect(controller.signal.aborted).toBe(true);
    await act(async () => task.resolve());
    expect(props.onBusyChange.mock.calls).toEqual([[true], [false]]);
    expect(props.onLogin).not.toHaveBeenCalled();
  });
  it("discards a completion after the owning session changes", async () => {
    const task = deferred();
    vi.mocked(requestPasswordReset).mockReturnValue(task.promise);
    const { props, rerender } = setupForgot();
    submitForgot();
    props.isCurrentSession.mockReturnValue(false);
    rerender(<ForgotPassword {...props} />);
    await act(async () => task.resolve());
    expect(screen.queryByText(recoveryRequestedMessage)).toBeNull();
    expect(props.onBusyChange.mock.calls).toEqual([[true]]);
  });
});

describe("Reset password", () => {
  it.each([null, "", "short", "a".repeat(44), `${"a".repeat(42)}=`])(
    "rejects a missing or malformed link %# without an API request",
    (value) => {
      const { props } = setupReset(value);
      expect(screen.getByRole("alert").textContent).toContain(
        "link é inválido",
      );
      expect(screen.queryByLabelText("Nova senha")).toBeNull();
      expect(resetPassword).not.toHaveBeenCalled();
      fireEvent.click(
        screen.getByRole("button", { name: "Voltar para entrar" }),
      );
      expect(props.onLogin).toHaveBeenCalledTimes(1);
    },
  );
  it("never renders or stores the reset token and does not submit on mount", () => {
    setupReset();
    expect(document.body.innerHTML).not.toContain(token);
    expect(screen.queryByRole("textbox", { name: /token/i })).toBeNull();
    expect(resetPassword).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
    expect(field("Nova senha").type).toBe("password");
  });
  it("validates both password fields and focuses the first invalid input", () => {
    setupReset();
    submitReset();
    expect(document.activeElement).toBe(field("Nova senha"));
    expect(field("Nova senha").getAttribute("aria-invalid")).toBe("true");
    expect(field("Confirmar nova senha").getAttribute("aria-invalid")).toBe(
      "true",
    );
    expect(resetPassword).not.toHaveBeenCalled();
    fillReset(password, password.trim());
    submitReset();
    expect(document.activeElement).toBe(field("Confirmar nova senha"));
    expect(resetPassword).not.toHaveBeenCalled();
  });
  it("allows explicitly showing and hiding both passwords", () => {
    setupReset();
    fillReset();
    fireEvent.click(screen.getByRole("button", { name: "Mostrar senhas" }));
    expect(field("Nova senha").type).toBe("text");
    expect(field("Confirmar nova senha").type).toBe("text");
    fireEvent.click(screen.getByRole("button", { name: "Ocultar senhas" }));
    expect(field("Nova senha").type).toBe("password");
  });
  it("submits the exact password once and waits for an explicit login action", async () => {
    const { props } = setupReset();
    fillReset();
    submitReset();
    await screen.findByText(passwordResetMessage);
    expect(resetPassword).toHaveBeenCalledWith(
      token,
      password,
      expect.any(AbortController),
    );
    expect(props.onReset).toHaveBeenCalledTimes(1);
    expect(props.onLogin).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Nova senha")).toBeNull();
    expect(document.body.textContent).not.toContain(password);
    expect(props.onBusyChange.mock.calls).toEqual([[true], [false]]);
    fireEvent.click(screen.getByRole("button", { name: "Voltar para entrar" }));
    expect(props.onLogin).toHaveBeenCalledTimes(1);
  });
  it.each(["invalid-link", "uncertain"] as const)(
    "clears both passwords and requires login/new recovery after %s",
    async (kind) => {
      vi.mocked(resetPassword).mockRejectedValue(
        new RecoveryError(
          kind,
          kind === "invalid-link"
            ? "Link inválido ou expirado."
            : "Sua senha pode ter sido alterada. Tente entrar com a nova senha.",
        ),
      );
      const { props } = setupReset();
      fillReset();
      submitReset();
      await screen.findByRole("alert");
      expect(field("Nova senha").value).toBe("");
      expect(field("Confirmar nova senha").value).toBe("");
      expect(
        (
          screen.getByRole("button", {
            name: "Redefinir senha",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
      expect(resetPassword).toHaveBeenCalledTimes(1);
      expect(props.onReset).not.toHaveBeenCalled();
      expect(
        (
          screen.getByRole("button", {
            name: "Voltar para entrar",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false);
    },
  );
  it("blocks duplicate reset submissions and navigation while writing", async () => {
    const task = deferred();
    vi.mocked(resetPassword).mockReturnValue(task.promise);
    const { props } = setupReset();
    fillReset();
    submitReset();
    submitReset();
    expect(resetPassword).toHaveBeenCalledTimes(1);
    expect(field("Nova senha").matches(":disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Voltar para entrar" }));
    expect(props.onLogin).not.toHaveBeenCalled();
    await act(async () => task.resolve());
    expect(props.onReset).toHaveBeenCalledTimes(1);
  });
  it("clears password drafts after a rate limit and allows only an explicit later submission", async () => {
    vi.useFakeTimers();
    vi.mocked(resetPassword).mockRejectedValue(
      new RecoveryError("rate-limit", "Aguarde.", Date.now() + 1000),
    );
    setupReset();
    fillReset();
    await act(async () => submitReset());
    expect(field("Nova senha").value).toBe("");
    expect(field("Confirmar nova senha").value).toBe("");
    expect(field("Nova senha").matches(":disabled")).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(field("Nova senha").matches(":disabled")).toBe(false);
    expect(resetPassword).toHaveBeenCalledTimes(1);
  });
  it("aborts pending reset and clears detached inputs on unmount without success callbacks", async () => {
    const task = deferred();
    vi.mocked(resetPassword).mockReturnValue(task.promise);
    const { props, unmount } = setupReset();
    fillReset();
    const first = field("Nova senha"),
      second = field("Confirmar nova senha");
    submitReset();
    const controller = vi.mocked(resetPassword).mock.calls[0][2];
    unmount();
    expect(controller.signal.aborted).toBe(true);
    expect(first.value).toBe("");
    expect(second.value).toBe("");
    await act(async () => task.resolve());
    expect(props.onReset).not.toHaveBeenCalled();
    expect(props.onBusyChange.mock.calls).toEqual([[true], [false]]);
  });
  it("discards a stale result after a session change", async () => {
    const task = deferred();
    vi.mocked(resetPassword).mockReturnValue(task.promise);
    const { props, rerender } = setupReset();
    fillReset();
    submitReset();
    props.isCurrentSession.mockReturnValue(false);
    rerender(<ResetPassword {...props} />);
    await act(async () => task.resolve());
    expect(props.onReset).not.toHaveBeenCalled();
    expect(props.onLogin).not.toHaveBeenCalled();
    expect(screen.queryByText(passwordResetMessage)).toBeNull();
  });
  it("starts with empty drafts when a different recovery link is supplied", async () => {
    const { props, rerender } = setupReset();
    fillReset();
    rerender(<ResetPassword {...props} token={"b".repeat(43)} />);
    await waitFor(() => expect(field("Nova senha").value).toBe(""));
    expect(field("Confirmar nova senha").value).toBe("");
    expect(resetPassword).not.toHaveBeenCalled();
  });
});
