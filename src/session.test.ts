// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
const user = {
  id: "user",
  name: "Test",
  email: "test@example.com",
  role: "CUSTOMER",
};
const result = (accessToken = "access") => ({
  accessToken,
  user,
  expiresIn: 900,
});
const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200 });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetModules();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("navigator", { locks: undefined });
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      addEventListener() {}
      postMessage() {}
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("Session client", () => {
  it("keeps access in memory and sends cookies for login", async () => {
    fetchMock.mockResolvedValueOnce(ok(result()));
    const s = await import("./session");
    await s.login("test@example.com", "secret");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      credentials: "include",
      method: "POST",
    });
    expect(localStorage.length).toBe(0);
  });
  it("deduplicates simultaneous refresh requests", async () => {
    fetchMock.mockResolvedValue(ok(result()));
    const s = await import("./session");
    await Promise.all([s.refresh(), s.refresh(), s.refresh()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      new Headers(fetchMock.mock.calls[0][1].headers).get("X-Requested-With"),
    ).toBe("JornadaTCG");
  });
  it("renews after 401 and retries once using the new access token", async () => {
    const s = await import("./session");
    fetchMock.mockResolvedValueOnce(ok(result("old")));
    await s.login("x", "y");
    fetchMock
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(ok(result("new")))
      .mockResolvedValueOnce(ok({ items: [] }));
    expect(await s.authorized("/cart")).toEqual({ items: [] });
    expect(
      new Headers(fetchMock.mock.calls[3][1].headers).get("Authorization"),
    ).toBe("Bearer new");
  });
  it("does not retry a network-ambiguous refresh", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    const s = await import("./session");
    await expect(s.refresh()).rejects.toThrow("offline");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("does not repeat a payment after an ambiguous network failure", async () => {
    const s = await import("./session");
    fetchMock.mockResolvedValueOnce(ok(result()));
    await s.login("x", "y");
    fetchMock.mockRejectedValueOnce(new Error("connection lost"));
    await expect(
      s.authorized("/orders/order/payments/pix", { method: "POST" }),
    ).rejects.toThrow("connection lost");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("rejects a late successful response after logout", async () => {
    const s = await import("./session");
    fetchMock.mockResolvedValueOnce(ok(result()));
    await s.login("x", "y");
    const response = deferred<Response>();
    fetchMock.mockReturnValueOnce(response.promise);
    const request = s.authorized("/cart");
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await s.logout();
    response.resolve(ok({ items: ["old account"] }));
    await expect(request).rejects.toThrow("Sessão alterada. Entre novamente.");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("does not refresh or retry a late 401 after a different account logs in", async () => {
    const s = await import("./session");
    fetchMock.mockResolvedValueOnce(ok(result()));
    await s.login("x", "y");
    const response = deferred<Response>();
    fetchMock.mockReturnValueOnce(response.promise);
    const request = s.authorized("/cart");
    fetchMock.mockResolvedValueOnce(ok(result("other-account")));
    await s.login("other@example.com", "other-password");
    response.resolve(new Response("{}", { status: 401 }));
    await expect(request).rejects.toThrow("Sessão alterada. Entre novamente.");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("does not send the retry when the account changes during refresh", async () => {
    const s = await import("./session");
    const listener = vi.fn();
    s.subscribe(listener);
    fetchMock.mockResolvedValueOnce(ok(result()));
    await s.login("x", "y");
    const response = deferred<Response>();
    const refreshStarted = deferred<void>();
    fetchMock
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockImplementationOnce(() => {
        refreshStarted.resolve();
        return response.promise;
      });
    const request = s.authorized("/cart");
    await refreshStarted.promise;
    const other = {
      ...result("other-account"),
      user: { ...user, id: "other-user" },
    };
    fetchMock.mockResolvedValueOnce(ok(other));
    await s.login("other@example.com", "other-password");
    response.resolve(ok(result("old-account-refreshed")));
    await expect(request).rejects.toThrow("Sessão alterada. Entre novamente.");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(listener).toHaveBeenLastCalledWith(other.user);
  });
  it("rejects the retried result if the user logs out while it is loading", async () => {
    const s = await import("./session");
    fetchMock.mockResolvedValueOnce(ok(result("old")));
    await s.login("x", "y");
    const response = deferred<Response>();
    const retryStarted = deferred<void>();
    fetchMock
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(ok(result("new")))
      .mockImplementationOnce(() => {
        retryStarted.resolve();
        return response.promise;
      });
    const request = s.authorized("/cart");
    await retryStarted.promise;
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await s.logout();
    response.resolve(ok({ items: ["old account"] }));
    await expect(request).rejects.toThrow("Sessão alterada. Entre novamente.");
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
  it.each([
    new Headers({ "X-Request-ID": "request-id" }),
    [["X-Request-ID", "request-id"]] as [string, string][],
  ])("preserves custom headers in RequestInit", async (headers) => {
    const s = await import("./session");
    fetchMock.mockResolvedValueOnce(ok(result()));
    await s.login("x", "y");
    fetchMock.mockResolvedValueOnce(ok({ items: [] }));
    await s.authorized("/cart", { headers });
    const sent = new Headers(fetchMock.mock.calls[1][1].headers);
    expect(sent.get("X-Request-ID")).toBe("request-id");
    expect(sent.get("Authorization")).toBe("Bearer access");
    expect(sent.get("X-Requested-With")).toBe("JornadaTCG");
  });
  it("notifies subscribers and clears session after logout", async () => {
    const s = await import("./session");
    const listener = vi.fn();
    s.subscribe(listener);
    fetchMock
      .mockResolvedValueOnce(ok(result()))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await s.login("x", "y");
    await s.logout();
    expect(listener).toHaveBeenLastCalledWith(null);
  });
  it("leaves multipart boundary selection to the browser and keeps cookies and bearer", async () => {
    const s = await import("./session");
    fetchMock.mockResolvedValueOnce(ok(result()));
    await s.login("x", "y");
    const body = new FormData();
    body.append("image", new File(["test"], "banner.png", { type: "image/png" }));
    fetchMock.mockResolvedValueOnce(ok({ id: "banner" }));
    await s.authorized("/admin/banners", {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json", "X-Custom": "value" },
    });
    const options = fetchMock.mock.calls[1][1];
    const headers = new Headers(options.headers);
    expect(options.body).toBe(body);
    expect(options.credentials).toBe("include");
    expect(headers.has("Content-Type")).toBe(false);
    expect(headers.get("Authorization")).toBe("Bearer access");
    expect(headers.get("X-Requested-With")).toBe("JornadaTCG");
    expect(headers.get("X-Custom")).toBe("value");
  });
  it("retries multipart only after a 401 and reuses the same FormData with fresh bearer", async () => {
    const s = await import("./session");
    fetchMock.mockResolvedValueOnce(ok(result("old")));
    await s.login("x", "y");
    const body = new FormData();
    body.append("title", "Banner");
    fetchMock
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(ok(result("new")))
      .mockResolvedValueOnce(ok({ id: "banner" }));
    await s.authorized("/admin/banners", { method: "POST", body });
    for (const index of [1, 3]) {
      expect(fetchMock.mock.calls[index][1].body).toBe(body);
      expect(new Headers(fetchMock.mock.calls[index][1].headers).has("Content-Type")).toBe(false);
    }
    expect(new Headers(fetchMock.mock.calls[3][1].headers).get("Authorization")).toBe("Bearer new");
  });
  it("preserves the JSON default for metadata requests", async () => {
    const s = await import("./session");
    fetchMock.mockResolvedValueOnce(ok(result()));
    await s.login("x", "y");
    fetchMock.mockResolvedValueOnce(ok({ id: "banner" }));
    await s.authorized("/admin/banners/banner", { method: "PATCH", body: '{"active":false}' });
    expect(new Headers(fetchMock.mock.calls[1][1].headers).get("Content-Type")).toBe("application/json");
  });
  it("reads a protected image as a blob without attempting JSON", async () => {
    const s = await import("./session");
    fetchMock.mockResolvedValueOnce(ok(result()));
    await s.login("x", "y");
    const response = new Response("image-bytes", { headers: { "Content-Type": "image/webp" } });
    const json = vi.spyOn(response, "json");
    const blob = vi.spyOn(response, "blob");
    fetchMock.mockResolvedValueOnce(response);
    const controller = new AbortController();
    const image = await s.authorizedBlob("/admin/banners/banner/image", { signal: controller.signal });
    expect(await image.text()).toBe("image-bytes");
    expect(image.type).toBe("image/webp");
    expect(blob).toHaveBeenCalledTimes(1);
    expect(json).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ credentials: "include", signal: controller.signal });
    expect(new Headers(fetchMock.mock.calls[1][1].headers).get("Authorization")).toBe("Bearer access");
  });
  it("deduplicates refresh across JSON and protected blob requests", async () => {
    const s = await import("./session");
    fetchMock.mockImplementation((url: string) => Promise.resolve(
      url.endsWith("/auth/refresh") ? ok(result()) :
      url.endsWith("/image") ? new Response("image") : ok({ data: [] }),
    ));
    const [data, image] = await Promise.all([
      s.authorized("/admin/banners"),
      s.authorizedBlob("/admin/banners/banner/image"),
    ]);
    expect(data).toEqual({ data: [] });
    expect(await image.text()).toBe("image");
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/auth/refresh"))).toHaveLength(1);
  });
  it("refreshes and retries a protected image once after a 401", async () => {
    const s = await import("./session");
    fetchMock.mockResolvedValueOnce(ok(result("old")));
    await s.login("x", "y");
    fetchMock
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(ok(result("new")))
      .mockResolvedValueOnce(new Response("image"));
    expect(await (await s.authorizedBlob("/admin/banners/banner/image")).text()).toBe("image");
    expect(new Headers(fetchMock.mock.calls[3][1].headers).get("Authorization")).toBe("Bearer new");
  });
  it("does not retry another 401 after the protected image retry", async () => {
    const s = await import("./session");
    fetchMock.mockResolvedValueOnce(ok(result()));
    await s.login("x", "y");
    fetchMock
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(ok(result("new")))
      .mockResolvedValueOnce(new Response('{"message":"Acesso negado."}', { status: 401 }));
    await expect(s.authorizedBlob("/admin/banners/banner/image")).rejects.toMatchObject({ status: 401, message: "Acesso negado." });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
  it.each([403, 404, 503])("keeps status %s for protected image errors without reading a blob", async (status) => {
    const s = await import("./session");
    fetchMock.mockResolvedValueOnce(ok(result()));
    await s.login("x", "y");
    const response = new Response("not JSON", { status });
    const blob = vi.spyOn(response, "blob");
    fetchMock.mockResolvedValueOnce(response);
    await expect(s.authorizedBlob("/admin/banners/banner/image")).rejects.toMatchObject({ status, message: "Não foi possível concluir a solicitação." });
    expect(blob).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("does not retry an image or multipart upload after a network failure", async () => {
    const s = await import("./session");
    fetchMock.mockResolvedValueOnce(ok(result()));
    await s.login("x", "y");
    fetchMock.mockRejectedValue(new Error("connection lost"));
    await expect(s.authorizedBlob("/admin/banners/banner/image")).rejects.toThrow("connection lost");
    await expect(s.authorized("/admin/banners", { method: "POST", body: new FormData() })).rejects.toThrow("connection lost");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("rejects a protected image that finishes decoding after logout", async () => {
    const s = await import("./session");
    fetchMock.mockResolvedValueOnce(ok(result()));
    await s.login("x", "y");
    const blob = deferred<Blob>();
    const response = new Response("image");
    vi.spyOn(response, "blob").mockReturnValue(blob.promise);
    fetchMock.mockResolvedValueOnce(response);
    const image = s.authorizedBlob("/admin/banners/banner/image");
    await vi.waitFor(() => expect(response.blob).toHaveBeenCalled());
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await s.logout();
    blob.resolve(new Blob(["old-account-image"]));
    await expect(image).rejects.toThrow("Sessão alterada. Entre novamente.");
  });
  it("does not refresh a late protected image 401 after another account logs in", async () => {
    const s = await import("./session");
    fetchMock.mockResolvedValueOnce(ok(result()));
    await s.login("x", "y");
    const response = deferred<Response>();
    fetchMock.mockReturnValueOnce(response.promise);
    const image = s.authorizedBlob("/admin/banners/banner/image");
    fetchMock.mockResolvedValueOnce(ok(result("other-account")));
    await s.login("other", "password");
    response.resolve(new Response("{}", { status: 401 }));
    await expect(image).rejects.toThrow("Sessão alterada. Entre novamente.");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
