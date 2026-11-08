import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RegistrationError,
  registerCustomer,
  validateRegistration,
} from "./registration";
import type { RegistrationInput } from "./registration";

const input = {
  name: " Test Customer ",
  email: " TEST@example.COM ",
  password: " senha preservada ",
};
const customer = {
  id: "209bcdbe-c5d7-4f55-a2c2-a8c07ca738c4",
  name: "Test Customer",
  email: "test@example.com",
  role: "CUSTOMER",
};
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Registration validation", () => {
  it("accepts backend boundaries without inventing password complexity rules", () => {
    const valid = {
      name: "x".repeat(120),
      email: `${"x".repeat(248)}@a.com`,
      password: "a".repeat(12),
    };
    expect(valid.email).toHaveLength(254);
    expect(validateRegistration(valid, valid.password)).toEqual({});
    expect(
      validateRegistration(
        { ...valid, password: "x".repeat(128) },
        "x".repeat(128),
      ),
    ).toEqual({});
  });

  it.each([
    ["name", ""],
    ["name", " "],
    ["name", "x".repeat(121)],
    ["email", ""],
    ["email", "not-an-email"],
    ["email", "a b@example.com"],
    ["email", `${"x".repeat(249)}@a.com`],
    ["password", "x".repeat(11)],
    ["password", "x".repeat(129)],
    ["password", " ".repeat(12)],
  ] as const)("rejects invalid %s", (field, value) => {
    const changed = { ...input, [field]: value };
    expect(validateRegistration(changed, changed.password)[field]).toBeTruthy();
  });

  it("checks confirmation locally and preserves meaningful password spaces", () => {
    expect(validateRegistration(input, input.password)).toEqual({});
    expect(validateRegistration(input, "").confirmation).toBeTruthy();
    expect(
      validateRegistration(input, input.password.trim()).confirmation,
    ).toBeTruthy();
  });

  it("reports all invalid fields without throwing for malformed runtime input", () => {
    const invalid = { name: 1, email: null, password: [] };
    expect(
      Object.keys(
        validateRegistration(invalid as unknown as RegistrationInput, ""),
      ),
    ).toEqual(["name", "email", "password", "confirmation"]);
  });
});

describe("Registration request", () => {
  it("makes one anonymous POST with normalized names/email, exact password and only allowed fields", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ ...customer, passwordHash: "must-not-leak", token: "secret" }, { status: 201 }),
    );
    const extra = { ...input, confirmation: input.password, role: "ADMIN" };
    expect(await registerCustomer(extra)).toEqual(customer);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/auth/register");
    expect(options).toMatchObject({
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "JornadaTCG",
      },
    });
    expect(JSON.parse(options!.body as string)).toEqual({
      name: "Test Customer",
      email: "test@example.com",
      password: input.password,
    });
    expect(options!.headers).not.toHaveProperty("Authorization");
  });

  it("does not contact the server for invalid data", async () => {
    await expect(
      registerCustomer({ ...input, password: "short" }),
    ).rejects.toMatchObject({ kind: "invalid" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [400, "invalid"],
    [409, "conflict"],
    [401, "uncertain"],
    [403, "uncertain"],
    [404, "uncertain"],
    [500, "uncertain"],
    [503, "uncertain"],
  ])("sanitizes HTTP %i without retrying", async (status, kind) => {
    fetchMock.mockResolvedValue(
      Response.json({ message: "private database password secret" }, { status }),
    );
    const error = await registerCustomer(input).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(RegistrationError);
    expect(error).toMatchObject({ kind });
    expect((error as Error).message).not.toMatch(/private|database|secret/);
    if (kind === "uncertain") {
      expect((error as Error).message).toContain("Tente entrar");
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["120", 120_000],
    ["0", 0],
    ["999999999999999999999999999", 3_600_000],
    ["invalid", 60_000],
    ["-1", 60_000],
    [null, 60_000],
  ])("honors bounded Retry-After %s", async (header, delay) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-22T12:00:00Z"));
    fetchMock.mockResolvedValue(
      new Response(null, {
        status: 429,
        headers: header === null ? {} : { "Retry-After": header },
      }),
    );
    await expect(registerCustomer(input)).rejects.toMatchObject({
      kind: "rate-limit",
      retryAt: Date.now() + delay,
    });
  });

  it.each([
    ["Thu, 22 Oct 2026 12:02:00 GMT", 120_000],
    ["Thu, 22 Oct 2026 14:00:00 GMT", 3_600_000],
    ["Wed, 21 Oct 2026 12:00:00 GMT", 60_000],
  ])("reads Retry-After HTTP date %s", async (header, delay) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-22T12:00:00Z"));
    fetchMock.mockResolvedValue(
      new Response(null, { status: 429, headers: { "Retry-After": header } }),
    );
    await expect(registerCustomer(input)).rejects.toMatchObject({
      kind: "rate-limit",
      retryAt: Date.now() + delay,
    });
  });

  it.each([
    null,
    [],
    {},
    { ...customer, id: "invalid" },
    { ...customer, name: " " },
    { ...customer, email: "invalid" },
    { ...customer, role: "ADMIN" },
    { user: customer, accessToken: "unexpected" },
  ])("treats malformed success as uncertain: %j", async (body) => {
    fetchMock.mockResolvedValue(Response.json(body, { status: 201 }));
    await expect(registerCustomer(input)).rejects.toMatchObject({
      kind: "uncertain",
      message: expect.stringContaining("Tente entrar"),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("requires 201 even when another success status has the expected body", async () => {
    fetchMock.mockResolvedValue(Response.json(customer, { status: 200 }));
    await expect(registerCustomer(input)).rejects.toMatchObject({
      kind: "uncertain",
    });
  });

  it("treats invalid JSON as uncertain", async () => {
    fetchMock.mockResolvedValue(new Response("not JSON", { status: 201 }));
    await expect(registerCustomer(input)).rejects.toMatchObject({
      kind: "uncertain",
    });
  });

  it("treats connection loss as uncertain without automatic retries", async () => {
    fetchMock.mockRejectedValue(new Error("private request URL and secret"));
    await expect(registerCustomer(input)).rejects.toMatchObject({
      kind: "uncertain",
      message: expect.stringContaining("Tente entrar"),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("times out after 15 seconds, aborts and does not retry", async () => {
    vi.useFakeTimers();
    fetchMock.mockReturnValue(new Promise(() => {}));
    const result = registerCustomer(input);
    const assertion = expect(result).rejects.toMatchObject({
      kind: "uncertain",
      message: expect.stringContaining("Tente entrar"),
    });
    await vi.advanceTimersByTimeAsync(14_999);
    expect(fetchMock.mock.calls[0][1]!.signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(fetchMock.mock.calls[0][1]!.signal!.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("also bounds waiting for the success response body", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue({
      status: 201,
      json: () => new Promise(() => {}),
    } as unknown as Response);
    const result = registerCustomer(input);
    const assertion = expect(result).rejects.toMatchObject({ kind: "uncertain" });
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not send a request when the caller has already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(registerCustomer(input, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("propagates cancellation and removes the caller's listener and timer", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const added = vi.spyOn(controller.signal, "addEventListener");
    const removed = vi.spyOn(controller.signal, "removeEventListener");
    fetchMock.mockReturnValue(new Promise(() => {}));
    const result = registerCustomer(input, controller.signal);
    const assertion = expect(result).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await assertion;
    expect(fetchMock.mock.calls[0][1]!.signal!.aborted).toBe(true);
    expect(removed).toHaveBeenCalledWith("abort", added.mock.calls[0][1]);
    expect(vi.getTimerCount()).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("cleans up timeout and abort listener after success", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const added = vi.spyOn(controller.signal, "addEventListener");
    const removed = vi.spyOn(controller.signal, "removeEventListener");
    fetchMock.mockResolvedValue(Response.json(customer, { status: 201 }));
    await registerCustomer(input, controller.signal);
    expect(removed).toHaveBeenCalledWith("abort", added.mock.calls[0][1]);
    expect(vi.getTimerCount()).toBe(0);
    controller.abort();
    expect(fetchMock.mock.calls[0][1]!.signal!.aborted).toBe(false);
  });
});
