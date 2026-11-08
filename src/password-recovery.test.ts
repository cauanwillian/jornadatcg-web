// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const token = "a".repeat(43);
const password = " nova senha válida ";
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Password recovery validation", () => {
  it("accepts backend email and password limits without extra complexity rules", () => {
    expect(validateRecoveryEmail(`${"a".repeat(248)}@a.com`)).toBeUndefined();
    expect(validateRecoveryPassword("a".repeat(12), "a".repeat(12))).toEqual(
      {},
    );
    expect(validateRecoveryPassword("a".repeat(128), "a".repeat(128))).toEqual(
      {},
    );
    expect(validateRecoveryPassword(password, password)).toEqual({});
  });
  it.each([null, 1, "", "not-email", "a b@a.com", `${"a".repeat(249)}@a.com`])(
    "rejects malformed email %#",
    (email) => {
      expect(validateRecoveryEmail(email)).toBeTruthy();
    },
  );
  it.each([null, 1, "a".repeat(11), "a".repeat(129), " ".repeat(12)])(
    "rejects invalid password %#",
    (value) => {
      expect(validateRecoveryPassword(value, value).password).toBeTruthy();
    },
  );
  it("checks confirmation without trimming password spaces", () => {
    expect(validateRecoveryPassword(password, "").confirmation).toBeTruthy();
    expect(
      validateRecoveryPassword(password, password.trim()).confirmation,
    ).toBeTruthy();
  });
  it("accepts exactly 43 base64url characters for reset links", () => {
    expect(validRecoveryToken(`${"a".repeat(40)}-_9`)).toBe(true);
    for (const value of [
      null,
      token.slice(1),
      `${token}a`,
      `${token.slice(1)}=`,
      `${token.slice(1)}/`,
      `${token.slice(1)} `,
    ])
      expect(validRecoveryToken(value)).toBe(false);
  });
  it("does not contact the API for malformed inputs", async () => {
    await expect(
      requestPasswordReset("invalid", new AbortController()),
    ).rejects.toMatchObject({ kind: "invalid" });
    await expect(
      resetPassword("bad", password, new AbortController()),
    ).rejects.toMatchObject({ kind: "invalid-link" });
    await expect(
      resetPassword(token, "short", new AbortController()),
    ).rejects.toMatchObject({ kind: "invalid" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Anonymous recovery requests", () => {
  it("normalizes only the email and accepts a generic 202 without exposing returned extras", async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        {
          message: recoveryRequestedMessage,
          token: "must-not-use",
          emailExists: true,
        },
        { status: 202 },
      ),
    );
    expect(
      await requestPasswordReset(" TEST@EXAMPLE.COM ", new AbortController()),
    ).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/forgot-password",
      expect.objectContaining({
        method: "POST",
        credentials: "omit",
        cache: "no-store",
        signal: expect.any(AbortSignal),
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "JornadaTCG",
        },
        body: JSON.stringify({ email: "test@example.com" }),
      }),
    );
  });
  it("sends the exact new password with only token and password, then requires login separately", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ message: passwordResetMessage }),
    );
    await resetPassword(token, password, new AbortController());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/reset-password",
      expect.objectContaining({
        method: "POST",
        credentials: "omit",
        body: JSON.stringify({ token, password }),
      }),
    );
  });
  it.each([
    null,
    {},
    [],
    { message: "Account does not exist" },
    { message: recoveryRequestedMessage.replace("senha", "senha!") },
  ])("rejects malformed or revealing acceptance body %#", async (value) => {
    fetchMock.mockResolvedValue(Response.json(value, { status: 202 }));
    await expect(
      requestPasswordReset("test@example.com", new AbortController()),
    ).rejects.toMatchObject({ kind: "uncertain" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each([201, 204, 400, 401, 403, 404, 409, 500, 503])(
    "sanitizes forgot HTTP %s and never retries",
    async (status) => {
      fetchMock.mockResolvedValue(
        new Response(status === 204 ? null : '{"message":"SECRET_INTERNAL"}', {
          status,
        }),
      );
      const caught = await requestPasswordReset(
        "test@example.com",
        new AbortController(),
      ).catch((error) => error);
      expect(caught).toBeInstanceOf(RecoveryError);
      expect(caught.message).not.toContain("SECRET_INTERNAL");
      expect(caught.kind).toBe(
        status === 400
          ? "invalid"
          : status === 503
            ? "unavailable"
            : "uncertain",
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
  it.each([400, 401, 403, 404, 409, 500, 503])(
    "sanitizes reset HTTP %s and never retries",
    async (status) => {
      fetchMock.mockResolvedValue(
        Response.json({ message: "SECRET_INTERNAL" }, { status }),
      );
      const caught = await resetPassword(
        token,
        password,
        new AbortController(),
      ).catch((error) => error);
      expect(caught).toBeInstanceOf(RecoveryError);
      expect(caught.message).not.toContain("SECRET_INTERNAL");
      expect(caught.kind).toBe(status === 400 ? "invalid-link" : "uncertain");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
  it("treats malformed reset success as uncertain rather than changing session", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ message: "ok", accessToken: "secret" }),
    );
    await expect(
      resetPassword(token, password, new AbortController()),
    ).rejects.toMatchObject({ kind: "uncertain" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each(["forgot", "reset"])(
    "does not leak raw network failures for %s",
    async (kind) => {
      fetchMock.mockRejectedValue(new Error(`SECRET_${token}_${password}`));
      const operation =
        kind === "forgot"
          ? requestPasswordReset("test@example.com", new AbortController())
          : resetPassword(token, password, new AbortController());
      const caught = await operation.catch((error) => error);
      expect(caught.kind).toBe("uncertain");
      expect(caught.message).not.toContain("SECRET");
      expect(caught.message).not.toContain(token);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
});

describe("Recovery limits and cancellation", () => {
  it.each([
    ["12", 12000],
    ["999999999999999999999", 3600000],
    ["0", 1000],
    ["invalid", 60000],
    [null, 60000],
  ] as const)("bounds Retry-After %s", async (header, delay) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-04T12:00:00Z"));
    fetchMock.mockResolvedValue(
      Response.json(
        {},
        { status: 429, headers: header ? { "Retry-After": header } : {} },
      ),
    );
    await expect(
      requestPasswordReset("test@example.com", new AbortController()),
    ).rejects.toMatchObject({
      kind: "rate-limit",
      retryAt: Date.now() + delay,
    });
  });
  it("accepts Retry-After as an HTTP date", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-04T12:00:00Z"));
    fetchMock.mockResolvedValue(
      Response.json(
        {},
        {
          status: 429,
          headers: { "Retry-After": "Wed, 04 Nov 2026 12:02:00 GMT" },
        },
      ),
    );
    await expect(
      resetPassword(token, password, new AbortController()),
    ).rejects.toMatchObject({
      kind: "rate-limit",
      retryAt: Date.now() + 120000,
    });
  });
  it("does not send a request when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      requestPasswordReset("test@example.com", controller),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(["fetch", "json"])(
    "bounds a stalled %s even when the mock ignores abort",
    async (stage) => {
      vi.useFakeTimers();
      fetchMock.mockImplementation(() =>
        stage === "fetch"
          ? new Promise(() => {})
          : Promise.resolve({
              status: 200,
              json: () => new Promise(() => {}),
            } as Response),
      );
      const controller = new AbortController();
      const operation = resetPassword(token, password, controller).catch(
        (error) => error,
      );
      await vi.advanceTimersByTimeAsync(15000);
      expect(await operation).toMatchObject({ kind: "uncertain" });
      expect(controller.signal.aborted).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it("cancels work on an external abort and cleans its timer", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const controller = new AbortController();
    const operation = requestPasswordReset(
      "test@example.com",
      controller,
    ).catch((error) => error);
    controller.abort();
    expect(await operation).toMatchObject({ name: "AbortError" });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cleans timers after valid completion", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(
      Response.json({ message: recoveryRequestedMessage }, { status: 202 }),
    );
    await requestPasswordReset("test@example.com", new AbortController());
    expect(vi.getTimerCount()).toBe(0);
  });
});
