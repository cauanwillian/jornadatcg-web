import { base } from "./api";

export const recoveryRequestedMessage =
  "Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha.";
export const passwordResetMessage =
  "Senha redefinida. Entre novamente com sua nova senha.";

export type RecoveryErrorKind =
  "invalid" | "invalid-link" | "rate-limit" | "unavailable" | "uncertain";
export class RecoveryError extends Error {
  readonly kind: RecoveryErrorKind;
  readonly retryAt?: number;
  constructor(kind: RecoveryErrorKind, message: string, retryAt?: number) {
    super(message);
    this.name = "RecoveryError";
    this.kind = kind;
    this.retryAt = retryAt;
  }
}

export function validRecoveryToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}
export function validateRecoveryEmail(email: unknown): string | undefined {
  return typeof email !== "string" ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
    ? "Informe um e-mail válido com até 254 caracteres."
    : undefined;
}
export function validateRecoveryPassword(
  password: unknown,
  confirmation: unknown,
): Partial<Record<"password" | "confirmation", string>> {
  const errors: Partial<Record<"password" | "confirmation", string>> = {};
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 128 ||
    !password.trim()
  )
    errors.password = "Use uma senha com 12 a 128 caracteres.";
  if (typeof confirmation !== "string" || !confirmation)
    errors.confirmation = "Confirme sua nova senha.";
  else if (confirmation !== password)
    errors.confirmation = "As senhas precisam ser iguais.";
  return errors;
}

const invalidLink = () =>
  new RecoveryError(
    "invalid-link",
    "O link é inválido ou expirou. Solicite um novo link de recuperação.",
  );
const uncertain = (reset: boolean) =>
  new RecoveryError(
    "uncertain",
    reset
      ? "Não foi possível confirmar a redefinição. Sua senha pode ter sido alterada. Tente entrar com a nova senha ou solicite outro link de recuperação."
      : "Não foi possível confirmar o envio do link. Aguarde alguns minutos, confira seu e-mail e tente novamente se necessário.",
  );
function retryTime(header: string | null): number {
  const now = Date.now();
  let delay = 60_000;
  if (header && /^\d+$/.test(header.trim())) {
    const seconds = Number(header.trim());
    delay = Number.isFinite(seconds) ? seconds * 1000 : 3_600_000;
  } else if (header) {
    const parsed = Date.parse(header);
    if (Number.isFinite(parsed) && parsed >= now) delay = parsed - now;
  }
  return now + Math.min(Math.max(1000, delay), 3_600_000);
}
function expectedMessage(value: unknown, expected: string): boolean {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "message" in value &&
    value.message === expected,
  );
}
async function send(
  body: { email: string } | { token: string; password: string },
  controller: AbortController,
): Promise<void> {
  const reset = "token" in body;
  if (controller.signal.aborted)
    throw new DOMException("Aborted", "AbortError");
  let timedOut = false;
  let stop!: () => void;
  const interrupted = new Promise<never>((_, reject) => {
    stop = () => reject(new DOMException("Aborted", "AbortError"));
    controller.signal.addEventListener("abort", stop, { once: true });
  });
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 15_000);
  try {
    const response = await Promise.race([
      fetch(`${base}/auth/${reset ? "reset-password" : "forgot-password"}`, {
        method: "POST",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "JornadaTCG",
        },
        signal: controller.signal,
        body: JSON.stringify(body),
      }),
      interrupted,
    ]);
    if (response.status === 400)
      throw reset
        ? invalidLink()
        : new RecoveryError("invalid", "Confira o e-mail informado.");
    if (response.status === 429)
      throw new RecoveryError(
        "rate-limit",
        "Muitas tentativas. Aguarde um pouco antes de tentar novamente.",
        retryTime(response.headers.get("Retry-After")),
      );
    if (!reset && response.status === 503)
      throw new RecoveryError(
        "unavailable",
        "A recuperação de senha está temporariamente indisponível. Tente novamente mais tarde.",
      );
    if (response.status !== (reset ? 200 : 202)) throw uncertain(reset);
    const value: unknown = await Promise.race([response.json(), interrupted]);
    if (
      !expectedMessage(
        value,
        reset ? passwordResetMessage : recoveryRequestedMessage,
      )
    )
      throw uncertain(reset);
  } catch (caught) {
    if (controller.signal.aborted && !timedOut)
      throw new DOMException("Aborted", "AbortError");
    if (caught instanceof RecoveryError) throw caught;
    throw uncertain(reset);
  } finally {
    window.clearTimeout(timer);
    controller.signal.removeEventListener("abort", stop);
  }
}

export async function requestPasswordReset(
  email: string,
  controller: AbortController,
): Promise<void> {
  if (validateRecoveryEmail(email))
    throw new RecoveryError("invalid", "Confira o e-mail informado.");
  return send({ email: email.trim().toLowerCase() }, controller);
}
export async function resetPassword(
  token: string,
  password: string,
  controller: AbortController,
): Promise<void> {
  if (!validRecoveryToken(token)) throw invalidLink();
  if (Object.keys(validateRecoveryPassword(password, password)).length)
    throw new RecoveryError(
      "invalid",
      "Use uma senha com 12 a 128 caracteres.",
    );
  return send({ token, password }, controller);
}
