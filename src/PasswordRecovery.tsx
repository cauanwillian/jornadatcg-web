import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  passwordResetMessage,
  RecoveryError,
  recoveryRequestedMessage,
  requestPasswordReset,
  resetPassword,
  validRecoveryToken,
  validateRecoveryEmail,
  validateRecoveryPassword,
} from "./password-recovery";

export interface RecoveryProps {
  onLogin: () => void;
  onBusyChange: (busy: boolean) => void;
  isCurrentSession?: () => boolean;
}
export interface ForgotPasswordProps extends RecoveryProps {
  initialEmail?: string;
}
export interface ResetPasswordProps extends RecoveryProps {
  token: string | null;
  onReset?: () => void;
}
const currentSession = () => true;

function useRecoveryRequest(props: RecoveryProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<RecoveryError | null>(null);
  const [now, setNow] = useState(Date.now);
  const alive = useRef(true);
  const lock = useRef(false);
  const parentBusy = useRef(false);
  const request = useRef<AbortController | null>(null);
  const callbacks = useRef(props);
  useLayoutEffect(() => {
    callbacks.current = props;
  });
  const current = () =>
    alive.current && (callbacks.current.isCurrentSession ?? currentSession)();
  function release() {
    if (!parentBusy.current) return;
    parentBusy.current = false;
    callbacks.current.onBusyChange(false);
  }
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      request.current?.abort();
      release();
    };
    // This mount owns its request; callbacks remain current in a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const retryAt = error?.retryAt;
  useEffect(() => {
    if (!retryAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [retryAt]);
  const seconds = retryAt ? Math.max(0, Math.ceil((retryAt - now) / 1000)) : 0;
  const canStart = () => current() && !lock.current && seconds === 0;
  async function run(task: (controller: AbortController) => Promise<void>) {
    if (!canStart()) return false;
    lock.current = true;
    parentBusy.current = true;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError(null);
    callbacks.current.onBusyChange(true);
    try {
      await task(controller);
      return current();
    } catch (caught) {
      if (current()) {
        setNow(Date.now());
        setError(
          caught instanceof RecoveryError
            ? caught
            : new RecoveryError(
                "uncertain",
                "Não foi possível confirmar a solicitação. Confira o resultado antes de tentar novamente.",
              ),
        );
      }
      return false;
    } finally {
      lock.current = false;
      if (request.current === controller) request.current = null;
      if (current()) {
        setBusy(false);
        release();
      }
    }
  }
  return {
    busy,
    error,
    seconds,
    blocked: busy || seconds > 0,
    current,
    canStart,
    run,
    login: () => {
      if (current() && !lock.current) callbacks.current.onLogin();
    },
  };
}

function RecoveryFeedback({
  error,
  seconds,
}: {
  error: RecoveryError | null;
  seconds: number;
}) {
  return (
    error && (
      <div className="registration-feedback" role="alert">
        <p>{error.message}</p>
        {seconds > 0 && (
          <p>Aguarde {seconds} segundos antes de tentar novamente.</p>
        )}
      </div>
    )
  );
}
function LoginButton({
  onClick,
  disabled = false,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="auth-switch">
      <button
        className="clear"
        type="button"
        disabled={disabled}
        onClick={onClick}
      >
        Voltar para entrar
      </button>
    </div>
  );
}

export function ForgotPassword(props: ForgotPasswordProps) {
  const [email, setEmail] = useState(props.initialEmail ?? "");
  const [issue, setIssue] = useState<string>();
  const [sent, setSent] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const flow = useRecoveryRequest(props);
  const id = useId();
  useEffect(() => {
    input.current?.focus();
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!flow.canStart() || sent) return;
    const problem = validateRecoveryEmail(email);
    setIssue(problem);
    if (problem) {
      input.current?.focus();
      return;
    }
    const accepted = await flow.run((controller) =>
      requestPasswordReset(email, controller),
    );
    if (accepted && flow.current()) setSent(true);
  }
  if (!(props.isCurrentSession ?? currentSession)()) return null;
  return (
    <section className="password-recovery" aria-label="Recuperar senha">
      {sent ? (
        <>
          <p className="auth-success" role="status">
            {recoveryRequestedMessage}
          </p>
          <p className="muted">
            Confira a caixa de entrada e a pasta de spam. O link tem validade
            curta e só pode ser usado uma vez.
          </p>
        </>
      ) : (
        <form
          noValidate
          onSubmit={(event) => void submit(event)}
          aria-busy={flow.busy}
        >
          <p className="muted">
            Informe o e-mail usado no cadastro para solicitar um link de
            recuperação.
          </p>
          <RecoveryFeedback error={flow.error} seconds={flow.seconds} />
          <fieldset className="registration-fieldset" disabled={flow.blocked}>
            <label htmlFor={`${id}-email`}>E-mail</label>
            <input
              ref={input}
              id={`${id}-email`}
              name="email"
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              required
              maxLength={254}
              value={email}
              aria-invalid={Boolean(issue)}
              aria-describedby={issue ? `${id}-email-error` : undefined}
              onChange={(event) => {
                if (!flow.busy && flow.current()) {
                  setEmail(event.target.value);
                  setIssue(undefined);
                }
              }}
            />
            {issue && (
              <p className="field-error" id={`${id}-email-error`}>
                {issue}
              </p>
            )}
            <button className="primary" type="submit" disabled={flow.blocked}>
              {flow.busy
                ? "Enviando solicitação…"
                : "Enviar link de recuperação"}
            </button>
          </fieldset>
        </form>
      )}
      <LoginButton onClick={flow.login} disabled={flow.busy} />
    </section>
  );
}

export function ResetPassword(props: ResetPasswordProps) {
  // A different link must never inherit the prior link's password draft or result.
  return <ResetPasswordContent key={props.token ?? "invalid"} {...props} />;
}
function ResetPasswordContent(props: ResetPasswordProps) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [visible, setVisible] = useState(false);
  const [issues, setIssues] = useState<
    Partial<Record<"password" | "confirmation", string>>
  >({});
  const [done, setDone] = useState(false);
  const flow = useRecoveryRequest(props);
  const form = useRef<HTMLFormElement>(null);
  const callbacks = useRef(props);
  const id = useId();
  useLayoutEffect(() => {
    callbacks.current = props;
  });
  useEffect(() => {
    const element = form.current;
    element?.querySelector("input")?.focus();
    return () => {
      element?.querySelectorAll("input").forEach((input) => {
        input.value = "";
      });
    };
  }, []);
  const validToken = validRecoveryToken(props.token);
  const uncertain = flow.error?.kind === "uncertain";
  const invalidLink = flow.error?.kind === "invalid-link";
  const blocked = flow.blocked || Boolean(uncertain || invalidLink);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!flow.canStart() || blocked || done || !validRecoveryToken(props.token))
      return;
    const problems = validateRecoveryPassword(password, confirmation);
    setIssues(problems);
    if (Object.keys(problems).length) {
      const first = Object.keys(problems)[0];
      form.current
        ?.querySelector<HTMLInputElement>(`[name="${first}"]`)
        ?.focus();
      return;
    }
    const accepted = await flow.run((controller) =>
      resetPassword(props.token!, password, controller),
    );
    if (!flow.current()) return;
    setPassword("");
    setConfirmation("");
    setVisible(false);
    if (accepted) {
      setDone(true);
      callbacks.current.onReset?.();
    }
  }
  function change(field: "password" | "confirmation", value: string) {
    if (!flow.current() || blocked) return;
    if (field === "password") setPassword(value);
    else setConfirmation(value);
    setIssues((previous) => ({
      ...previous,
      [field]: undefined,
      ...(field === "password" ? { confirmation: undefined } : {}),
    }));
  }
  if (!(props.isCurrentSession ?? currentSession)()) return null;
  return (
    <section className="password-recovery" aria-label="Definir nova senha">
      {!validToken ? (
        <p className="error" role="alert">
          O link é inválido ou está incompleto. Solicite um novo link de
          recuperação.
        </p>
      ) : done ? (
        <p className="auth-success" role="status">
          {passwordResetMessage}
        </p>
      ) : (
        <form
          ref={form}
          noValidate
          onSubmit={(event) => void submit(event)}
          aria-busy={flow.busy}
          autoComplete="off"
        >
          <p className="muted">
            Escolha uma nova senha. Depois da redefinição, entre novamente para
            continuar suas compras.
          </p>
          <RecoveryFeedback error={flow.error} seconds={flow.seconds} />
          <fieldset className="registration-fieldset" disabled={blocked}>
            <label htmlFor={`${id}-password`}>Nova senha</label>
            <input
              id={`${id}-password`}
              name="password"
              type={visible ? "text" : "password"}
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
              value={password}
              aria-invalid={Boolean(issues.password)}
              aria-describedby={`${id}-hint${issues.password ? ` ${id}-password-error` : ""}`}
              onChange={(event) => change("password", event.target.value)}
            />
            <p className="registration-hint" id={`${id}-hint`}>
              Use entre 12 e 128 caracteres.
            </p>
            {issues.password && (
              <p className="field-error" id={`${id}-password-error`}>
                {issues.password}
              </p>
            )}
            <label htmlFor={`${id}-confirmation`}>Confirmar nova senha</label>
            <input
              id={`${id}-confirmation`}
              name="confirmation"
              type={visible ? "text" : "password"}
              autoComplete="new-password"
              required
              maxLength={128}
              value={confirmation}
              aria-invalid={Boolean(issues.confirmation)}
              aria-describedby={
                issues.confirmation ? `${id}-confirmation-error` : undefined
              }
              onChange={(event) => change("confirmation", event.target.value)}
            />
            {issues.confirmation && (
              <p className="field-error" id={`${id}-confirmation-error`}>
                {issues.confirmation}
              </p>
            )}
            <button
              className="clear password-toggle"
              type="button"
              aria-pressed={visible}
              onClick={() => setVisible((value) => !value)}
            >
              {visible ? "Ocultar senhas" : "Mostrar senhas"}
            </button>
            <button className="primary" type="submit" disabled={blocked}>
              {flow.busy ? "Redefinindo senha…" : "Redefinir senha"}
            </button>
          </fieldset>
        </form>
      )}
      <LoginButton onClick={flow.login} disabled={flow.busy} />
    </section>
  );
}
