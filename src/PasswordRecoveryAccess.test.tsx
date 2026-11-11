// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountActions, ShopProvider } from "./Shop";
import * as session from "./session";
import type { User } from "./session";
import type {
  ForgotPasswordProps,
  ResetPasswordProps,
} from "./PasswordRecovery";

const forms = vi.hoisted(() => ({
  forgot: [] as ForgotPasswordProps[],
  reset: [] as ResetPasswordProps[],
}));
vi.mock("./session", () => ({
  subscribe: vi.fn(),
  refresh: vi.fn(),
  authorized: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  invalidateSession: vi.fn(),
}));
vi.mock("./PasswordRecovery", () => ({
  ForgotPassword: (props: ForgotPasswordProps) => {
    forms.forgot.push(props);
    return (
      <section aria-label="Recuperação simulada">
        <p>E-mail inicial: {props.initialEmail}</p>
        <button onClick={() => props.onBusyChange(true)}>
          Iniciar recuperação
        </button>
        <button onClick={() => props.onBusyChange(false)}>
          Concluir operação
        </button>
        <button onClick={props.onLogin}>Voltar para entrar</button>
      </section>
    );
  },
  ResetPassword: (props: ResetPasswordProps) => {
    forms.reset.push(props);
    return (
      <section aria-label="Redefinição simulada">
        <p>{props.token ? "Link recebido" : "Link inválido"}</p>
        <button onClick={() => props.onBusyChange(true)}>
          Iniciar redefinição
        </button>
        <button onClick={() => props.onBusyChange(false)}>
          Concluir operação
        </button>
        <button onClick={props.onReset}>Confirmar sucesso</button>
        <button onClick={props.onLogin}>Voltar para entrar</button>
      </section>
    );
  },
}));
const token = "a".repeat(43);
const user: User = {
  id: "user-a",
  name: "Cliente",
  email: "demo@example.com",
  role: "CUSTOMER",
};
const other: User = { ...user, id: "user-b", name: "Outra pessoa" };
let notify: (user: User | null) => void;
beforeEach(() => {
  vi.resetAllMocks();
  forms.forgot = [];
  forms.reset = [];
  sessionStorage.clear();
  HTMLDialogElement.prototype.showModal = vi.fn(function (
    this: HTMLDialogElement,
  ) {
    this.open = true;
  });
  vi.mocked(session.subscribe).mockImplementation((listener) => {
    notify = listener;
    return () => {};
  });
  vi.mocked(session.refresh).mockRejectedValue(new Error("Sessão ausente."));
  vi.mocked(session.authorized).mockResolvedValue({
    items: [],
    summary: { totalQuantity: 0, subtotal: "0.00" },
  });
  vi.mocked(session.invalidateSession).mockImplementation(() => notify(null));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function view(recovery?: { present: boolean; token: string | null }) {
  return render(
    <ShopProvider recovery={recovery}>
      <AccountActions />
    </ShopProvider>,
  );
}
async function openForgot() {
  view();
  fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
  fireEvent.change(screen.getByLabelText("E-mail"), {
    target: { value: "saved@example.com" },
  });
  fireEvent.change(screen.getByLabelText("Senha"), {
    target: { value: "previous password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Esqueci minha senha" }));
  await screen.findByRole("dialog", { name: "Recupere sua senha" });
}
const closeButton = () =>
  screen.getByRole<HTMLButtonElement>("button", { name: "Fechar" });
describe("Password recovery navigation and ownership", () => {
  it("opens forgot password from login, preserving email and clearing the login password", async () => {
    await openForgot();
    expect(screen.getByText("E-mail inicial: saved@example.com")).toBeTruthy();
    expect(session.login).not.toHaveBeenCalled();
    expect(session.authorized).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Voltar para entrar" }));
    expect(
      screen.getByRole("dialog", { name: "Entre na sua conta" }),
    ).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>("Senha").value).toBe("");
    expect(screen.getByLabelText<HTMLInputElement>("E-mail").value).toBe(
      "saved@example.com",
    );
  });
  it("keeps forgot password visible after a signed-out refresh notification", async () => {
    await openForgot();
    act(() => notify(null));
    expect(
      screen.getByRole("dialog", { name: "Recupere sua senha" }),
    ).toBeTruthy();
  });
  it.each([token, null])(
    "opens a recovery link before login and preserves it on null refresh %#",
    async (value) => {
      view({ present: true, token: value });
      await screen.findByRole("dialog", { name: "Defina uma nova senha" });
      act(() => notify(null));
      expect(screen.getByLabelText("Redefinição simulada")).toBeTruthy();
      expect(forms.reset.at(-1)?.token).toBe(value);
      expect(session.login).not.toHaveBeenCalled();
    },
  );
  it("does not open reset when no recovery fragment was present", () => {
    view({ present: false, token: null });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(forms.reset).toHaveLength(0);
  });
  it.each(["forgot", "reset"])(
    "blocks close, Escape and login navigation during %s write",
    async (kind) => {
      if (kind === "forgot") await openForgot();
      else view({ present: true, token });
      const start =
        kind === "forgot" ? "Iniciar recuperação" : "Iniciar redefinição";
      fireEvent.click(screen.getByRole("button", { name: start }));
      expect(closeButton().disabled).toBe(true);
      fireEvent.click(closeButton());
      fireEvent(
        screen.getByRole("dialog"),
        new Event("cancel", { bubbles: true, cancelable: true }),
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Voltar para entrar" }),
      );
      expect(
        screen.getByRole("dialog").getAttribute("aria-labelledby"),
      ).toBeTruthy();
      expect(
        screen.queryByRole("dialog", { name: "Entre na sua conta" }),
      ).toBeNull();
      fireEvent.click(
        screen.getByRole("button", { name: "Concluir operação" }),
      );
      fireEvent.click(closeButton());
      expect(screen.queryByRole("dialog")).toBeNull();
    },
  );
  it("invalidates only local session after a confirmed reset and returns to login without automatic sign-in", async () => {
    view({ present: true, token });
    await screen.findByLabelText("Redefinição simulada");
    act(() => notify(user));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar sucesso" }));
    expect(session.invalidateSession).toHaveBeenCalledTimes(1);
    expect(session.logout).not.toHaveBeenCalled();
    expect(session.login).not.toHaveBeenCalled();
    const login = screen.getByRole("dialog", { name: "Entre na sua conta" });
    expect(within(login).getByRole("status").textContent).toBe(
      "Senha redefinida. Entre novamente com sua nova senha.",
    );
    expect(forms.reset.at(-1)?.token).toBe(token);
    expect(screen.getByLabelText<HTMLInputElement>("Senha").value).toBe("");
  });
  it("allows leaving an invalid link for login without logging out another session", () => {
    view({ present: true, token: null });
    fireEvent.click(screen.getByRole("button", { name: "Voltar para entrar" }));
    expect(
      screen.getByRole("dialog", { name: "Entre na sua conta" }),
    ).toBeTruthy();
    expect(session.invalidateSession).not.toHaveBeenCalled();
    expect(session.logout).not.toHaveBeenCalled();
  });
  it("rejects old success, login and busy callbacks after a newer account generation", () => {
    view({ present: true, token });
    const stale = forms.reset.at(-1)!;
    act(() => notify(user));
    const fresh = forms.reset.at(-1)!;
    expect(stale.isCurrentSession?.()).toBe(false);
    expect(fresh.isCurrentSession?.()).toBe(true);
    act(() => {
      fresh.onBusyChange(true);
      stale.onBusyChange(false);
      stale.onLogin();
      stale.onReset?.();
    });
    expect(closeButton().disabled).toBe(true);
    expect(
      screen.getByRole("dialog", { name: "Defina uma nova senha" }),
    ).toBeTruthy();
    expect(session.invalidateSession).not.toHaveBeenCalled();
    act(() => fresh.onBusyChange(false));
  });
  it("does not revive the old link callbacks after account A to B to A", () => {
    view({ present: true, token });
    act(() => notify(user));
    const stale = forms.reset.at(-1)!;
    act(() => notify(other));
    act(() => notify(user));
    expect(stale.isCurrentSession?.()).toBe(false);
    act(() => {
      stale.onReset?.();
      stale.onLogin();
    });
    expect(session.invalidateSession).not.toHaveBeenCalled();
    expect(
      screen.getByRole("dialog", { name: "Defina uma nova senha" }),
    ).toBeTruthy();
  });
  it("rejects old forgot callbacks after a changed session", async () => {
    await openForgot();
    const stale = forms.forgot.at(-1)!;
    act(() => notify(user));
    const fresh = forms.forgot.at(-1)!;
    act(() => {
      fresh.onBusyChange(true);
      stale.onBusyChange(false);
      stale.onLogin();
    });
    expect(stale.isCurrentSession?.()).toBe(false);
    expect(closeButton().disabled).toBe(true);
    expect(
      screen.getByRole("dialog", { name: "Recupere sua senha" }),
    ).toBeTruthy();
    act(() => fresh.onBusyChange(false));
  });
});
