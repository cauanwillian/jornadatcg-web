import { base } from "./api";

export interface RegistrationInput {
  name: string;
  email: string;
  password: string;
}

export type RegistrationField = "name" | "email" | "password" | "confirmation";
type RegistrationKind = "invalid" | "conflict" | "rate-limit" | "uncertain";

interface RegisteredCustomer {
  id: string;
  name: string;
  email: string;
  role: "CUSTOMER";
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uncertainMessage =
  "Não foi possível confirmar o cadastro. Sua conta pode ter sido criada. Tente entrar com o email e a senha informados antes de cadastrar novamente.";

export class RegistrationError extends Error {
  readonly kind: RegistrationKind;
  readonly retryAt?: number;

  constructor(kind: RegistrationKind, message: string, retryAt?: number) {
    super(message);
    this.name = "RegistrationError";
    this.kind = kind;
    this.retryAt = retryAt;
  }
}

export function validateRegistration(
  input: RegistrationInput,
  confirmation: string,
): Partial<Record<RegistrationField, string>> {
  const errors: Partial<Record<RegistrationField, string>> = {};
  if (
    typeof input?.name !== "string" ||
    !input.name.trim() ||
    input.name.length > 120
  ) {
    errors.name = "Informe seu nome com até 120 caracteres.";
  }
  if (
    typeof input?.email !== "string" ||
    input.email.length > 254 ||
    !emailPattern.test(input.email.trim())
  ) {
    errors.email = "Informe um email válido com até 254 caracteres.";
  }
  if (
    typeof input?.password !== "string" ||
    input.password.length < 12 ||
    input.password.length > 128 ||
    !input.password.trim()
  ) {
    errors.password = "Use uma senha com 12 a 128 caracteres.";
  }
  if (typeof confirmation !== "string" || !confirmation) {
    errors.confirmation = "Confirme sua senha.";
  } else if (confirmation !== input?.password) {
    errors.confirmation = "As senhas precisam ser iguais.";
  }
  return errors;
}

function retryTime(header: string | null): number {
  const now = Date.now();
  let delay = 60_000;
  if (header && /^\d+$/.test(header.trim())) {
    delay = Number(header.trim()) * 1_000;
  } else if (header) {
    const date = Date.parse(header);
    if (Number.isFinite(date) && date >= now) delay = date - now;
  }
  return now + Math.min(delay, 3_600_000);
}

function publicCustomer(value: unknown): RegisteredCustomer | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (
    !("id" in value) ||
    typeof value.id !== "string" ||
    !uuidPattern.test(value.id) ||
    !("name" in value) ||
    typeof value.name !== "string" ||
    !value.name.trim() ||
    value.name.length > 120 ||
    !("email" in value) ||
    typeof value.email !== "string" ||
    value.email.length > 254 ||
    !emailPattern.test(value.email) ||
    !("role" in value) ||
    value.role !== "CUSTOMER"
  ) {
    return null;
  }
  return {
    id: value.id,
    name: value.name,
    email: value.email,
    role: "CUSTOMER",
  };
}

export async function registerCustomer(
  input: RegistrationInput,
  signal?: AbortSignal,
): Promise<RegisteredCustomer> {
  if (Object.keys(validateRegistration(input, input?.password)).length) {
    throw new RegistrationError("invalid", "Revise os dados do cadastro.");
  }
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const controller = new AbortController();
  let timedOut = false;
  let rejectAbort: (reason: DOMException) => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const abort = () => {
    controller.abort();
    rejectAbort(new DOMException("Aborted", "AbortError"));
  };
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    abort();
  }, 15_000);

  try {
    const response = await Promise.race([
      fetch(`${base}/auth/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "JornadaTCG",
        },
        credentials: "omit",
        cache: "no-store",
        signal: controller.signal,
        body: JSON.stringify({
          name: input.name.trim(),
          email: input.email.trim().toLowerCase(),
          password: input.password,
        }),
      }),
      aborted,
    ]);
    if (response.status === 400) {
      throw new RegistrationError("invalid", "Revise os dados do cadastro.");
    }
    if (response.status === 409) {
      throw new RegistrationError(
        "conflict",
        "Não foi possível cadastrar este email. Se você já tem uma conta, tente entrar.",
      );
    }
    if (response.status === 429) {
      throw new RegistrationError(
        "rate-limit",
        "Muitas tentativas de cadastro. Aguarde um pouco antes de tentar novamente.",
        retryTime(response.headers.get("Retry-After")),
      );
    }
    if (response.status !== 201) {
      throw new RegistrationError("uncertain", uncertainMessage);
    }
    const body: unknown = await Promise.race([response.json(), aborted]);
    const customer = publicCustomer(body);
    if (!customer) throw new RegistrationError("uncertain", uncertainMessage);
    return customer;
  } catch (error) {
    if (signal?.aborted && !timedOut) {
      throw new DOMException("Aborted", "AbortError");
    }
    if (error instanceof RegistrationError) throw error;
    throw new RegistrationError("uncertain", uncertainMessage);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
