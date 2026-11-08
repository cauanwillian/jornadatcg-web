import { base } from "./api";
export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}
interface LoginResult {
  accessToken: string;
  user: User;
  expiresIn: number;
}
let token: string | null = null;
let expires = 0;
let version = 0;
let pending: Promise<LoginResult> | null = null;
const channel =
  typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("jornada-session")
    : null;
const listeners = new Set<(user: User | null) => void>();
function clear() {
  version++;
  token = null;
  expires = 0;
  listeners.forEach((fn) => fn(null));
}
/** Discard this browser's credentials after a confirmed password reset. */
export function invalidateSession() {
  clear();
  channel?.postMessage("changed");
}
channel?.addEventListener("message", () => clear());
export function subscribe(fn: (user: User | null) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
async function request(
  path: string,
  options: RequestInit = {},
  responseType: "json" | "blob" = "json",
) {
  const headers = new Headers(options.headers);
  if (options.body instanceof FormData) headers.delete("Content-Type");
  else if (!headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");
  headers.set("X-Requested-With", "JornadaTCG");
  const response = await fetch(`${base}${path}`, {
    ...options,
    credentials: "include",
    headers,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(
      typeof body.message === "string"
        ? body.message
        : "Não foi possível concluir a solicitação.",
    ) as Error & { status: number };
    error.status = response.status;
    throw error;
  }
  if (responseType === "blob") return response.blob();
  return response.status === 204 ? undefined : response.json();
}
async function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  return navigator.locks
    ? navigator.locks.request("jornada-session", fn)
    : fn();
}
function accept(data: LoginResult) {
  token = data.accessToken;
  expires = Date.now() + data.expiresIn * 1000;
  listeners.forEach((fn) => fn(data.user));
  return data;
}
function assertSession(expected: number) {
  if (version !== expected)
    throw new Error("Sessão alterada. Entre novamente.");
}
export function refresh() {
  if (!pending) {
    const start = version;
    pending = exclusive(async () => {
      try {
        assertSession(start);
        const data = (await request("/auth/refresh", {
          method: "POST",
        })) as LoginResult;
        assertSession(start);
        return accept(data);
      } catch (e) {
        if (version === start) clear();
        throw e;
      }
    }).finally(() => {
      pending = null;
    });
  }
  return pending;
}
export async function login(email: string, password: string) {
  return exclusive(async () => {
    const data = (await request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    })) as LoginResult;
    version++;
    channel?.postMessage("changed");
    return accept(data);
  });
}
export async function logout() {
  return exclusive(async () => {
    await request("/auth/logout", { method: "POST" });
    clear();
    channel?.postMessage("changed");
  });
}
async function authorizedRequest<T>(
  path: string,
  options: RequestInit,
  responseType: "json" | "blob",
): Promise<T> {
  const started = version;
  if (!token || Date.now() > expires - 30000) await refresh();
  assertSession(started);
  const used = token;
  const send = () => {
    const headers = new Headers(options.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return request(path, { ...options, headers }, responseType) as Promise<T>;
  };
  try {
    const result = await send();
    assertSession(started);
    return result;
  } catch (e) {
    assertSession(started);
    if ((e as { status?: number }).status !== 401) throw e;
    if (token === used) await refresh();
    assertSession(started);
    const result = await send();
    assertSession(started);
    return result;
  }
}

export function authorized<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  return authorizedRequest<T>(path, options, "json");
}

export function authorizedBlob(
  path: string,
  options: RequestInit = {},
): Promise<Blob> {
  return authorizedRequest<Blob>(path, options, "blob");
}
