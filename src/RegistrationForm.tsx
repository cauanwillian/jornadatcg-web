import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  registerCustomer,
  RegistrationError,
  validateRegistration,
} from "./registration";
import type { RegistrationField } from "./registration";

interface Props {
  initialEmail?: string;
  onLogin: (email: string, created: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}

export function Registration({
  initialEmail = "",
  onLogin,
  onBusyChange,
}: Props) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [issues, setIssues] = useState<
    Partial<Record<RegistrationField, string>>
  >({});
  const [error, setError] = useState<RegistrationError | null>(null);
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(false);
  const [now, setNow] = useState(Date.now);
  const id = useId();
  const lock = useRef(false);
  const alive = useRef(true);
  const request = useRef<AbortController | null>(null);
  const callbacks = useRef({ onLogin, onBusyChange });
  useLayoutEffect(() => {
    callbacks.current = { onLogin, onBusyChange };
  }, [onLogin, onBusyChange]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      request.current?.abort();
      if (lock.current) callbacks.current.onBusyChange(false);
    };
  }, []);
  const retryAt = error?.retryAt;
  useEffect(() => {
    if (!retryAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [retryAt]);
  const seconds = retryAt ? Math.max(0, Math.ceil((retryAt - now) / 1000)) : 0;
  const uncertain = error?.kind === "uncertain";
  const blocked = busy || uncertain || seconds > 0;

  function clearIssue(field: RegistrationField) {
    setIssues((current) => ({ ...current, [field]: undefined }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || blocked) return;
    const input = { name, email, password };
    const problems = validateRegistration(input, confirmation);
    setIssues(problems);
    setError(null);
    if (Object.keys(problems).length) {
      const first = Object.keys(problems)[0];
      const field = event.currentTarget.elements.namedItem(first);
      if (field instanceof HTMLInputElement) field.focus();
      return;
    }
    lock.current = true;
    setBusy(true);
    callbacks.current.onBusyChange(true);
    const controller = new AbortController();
    request.current = controller;
    try {
      const created = await registerCustomer(input, controller.signal);
      if (!alive.current) return;
      callbacks.current.onLogin(created.email, true);
    } catch (caught) {
      if (!alive.current) return;
      setNow(Date.now());
      setError(
        caught instanceof RegistrationError
          ? caught
          : new RegistrationError(
              "uncertain",
              "Não foi possível confirmar o cadastro. Ele pode ter sido concluído. Tente entrar com o e-mail informado antes de cadastrar novamente.",
            ),
      );
    } finally {
      request.current = null;
      lock.current = false;
      if (alive.current) {
        setPassword("");
        setConfirmation("");
        setVisible(false);
        setBusy(false);
        callbacks.current.onBusyChange(false);
      }
    }
  }

  function description(field: RegistrationField, hint?: boolean) {
    return (
      [
        hint ? `${id}-${field}-hint` : "",
        issues[field] ? `${id}-${field}-error` : "",
      ]
        .filter(Boolean)
        .join(" ") || undefined
    );
  }

  return (
    <form
      className="registration-form"
      noValidate
      onSubmit={(event) => void submit(event)}
      aria-busy={busy}
    >
      <p className="muted">
        Crie sua conta para comprar cartas e acumular suas compras até pedir o
        envio.
      </p>
      {error && (
        <div className="registration-feedback" role="alert">
          <p>{error.message}</p>
          {seconds > 0 && (
            <p>Aguarde {seconds} segundos antes de tentar novamente.</p>
          )}
          {uncertain && (
            <div className="button-row">
              <button
                type="button"
                className="outline"
                onClick={() =>
                  callbacks.current.onLogin(email.trim().toLowerCase(), false)
                }
              >
                Tentar entrar
              </button>
              <button
                type="button"
                className="clear"
                onClick={() => setError(null)}
              >
                Revisar cadastro
              </button>
            </div>
          )}
        </div>
      )}
      <fieldset className="registration-fieldset" disabled={blocked}>
        <label htmlFor={`${id}-name`}>Nome</label>
        <input
          id={`${id}-name`}
          name="name"
          autoComplete="name"
          required
          maxLength={120}
          value={name}
          aria-invalid={!!issues.name}
          aria-describedby={description("name")}
          onChange={(event) => {
            setName(event.target.value);
            clearIssue("name");
          }}
        />
        {issues.name && (
          <p className="field-error" id={`${id}-name-error`}>
            {issues.name}
          </p>
        )}

        <label htmlFor={`${id}-email`}>E-mail</label>
        <input
          id={`${id}-email`}
          name="email"
          type="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          maxLength={254}
          value={email}
          aria-invalid={!!issues.email}
          aria-describedby={description("email")}
          onChange={(event) => {
            setEmail(event.target.value);
            clearIssue("email");
          }}
        />
        {issues.email && (
          <p className="field-error" id={`${id}-email-error`}>
            {issues.email}
          </p>
        )}

        <label htmlFor={`${id}-password`}>Senha</label>
        <input
          id={`${id}-password`}
          name="password"
          type={visible ? "text" : "password"}
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={128}
          value={password}
          aria-invalid={!!issues.password}
          aria-describedby={description("password", true)}
          onChange={(event) => {
            setPassword(event.target.value);
            clearIssue("password");
            clearIssue("confirmation");
          }}
        />
        <p className="registration-hint" id={`${id}-password-hint`}>
          Use entre 12 e 128 caracteres.
        </p>
        {issues.password && (
          <p className="field-error" id={`${id}-password-error`}>
            {issues.password}
          </p>
        )}

        <label htmlFor={`${id}-confirmation`}>Confirmar senha</label>
        <input
          id={`${id}-confirmation`}
          name="confirmation"
          type={visible ? "text" : "password"}
          autoComplete="new-password"
          required
          maxLength={128}
          value={confirmation}
          aria-invalid={!!issues.confirmation}
          aria-describedby={description("confirmation")}
          onChange={(event) => {
            setConfirmation(event.target.value);
            clearIssue("confirmation");
          }}
        />
        {issues.confirmation && (
          <p className="field-error" id={`${id}-confirmation-error`}>
            {issues.confirmation}
          </p>
        )}

        <button
          type="button"
          className="clear password-toggle"
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
        >
          {visible ? "Ocultar senhas" : "Mostrar senhas"}
        </button>
        <button className="primary" type="submit" disabled={blocked}>
          {busy ? "Criando conta…" : "Criar conta"}
        </button>
      </fieldset>
      <div className="auth-switch">
        <span>Já se cadastrou?</span>
        <button
          type="button"
          className="clear"
          disabled={busy}
          onClick={() =>
            callbacks.current.onLogin(email.trim().toLowerCase(), false)
          }
        >
          Já tenho conta
        </button>
      </div>
    </form>
  );
}
