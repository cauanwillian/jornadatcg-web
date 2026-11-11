// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NotificationsArea } from "./NotificationsArea";
import { authorized } from "./session";
import type { JourneyNotification, NotificationKind } from "./notifications";

vi.mock("./session", () => ({ authorized: vi.fn() }));
const orderId = "68a7b7af-18a9-46ab-b44d-a7438cbb5c02";
const shipmentId = "18a7b7af-18a9-46ab-b44d-a7438cbb5c02";
const current = () => true;
const nothing = async () => {};
function item(
  kind: NotificationKind = "ORDER_CREATED",
  changes: Partial<JourneyNotification> = {},
): JourneyNotification {
  const id = kind.startsWith("ORDER_") ? orderId : shipmentId;
  return {
    id: `${kind}:${id}`,
    kind,
    occurredAt: "2026-10-23T18:00:00.000Z",
    title: "Pedido criado",
    message: "Seu pedido #42 foi criado.",
    target: { type: kind.startsWith("ORDER_") ? "order" : "shipment", id },
    ...(kind.startsWith("ORDER_") ? { orderNumber: 42 } : {}),
    ...changes,
  };
}
const page = (items = [item()], cursor: string | null = null) => ({
  items,
  nextCursor: cursor,
  hasMore: cursor !== null,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function view(props: Partial<Parameters<typeof NotificationsArea>[0]> = {}) {
  return render(
    <NotificationsArea
      isCurrentSession={current}
      onOpenTarget={nothing}
      {...props}
    />,
  );
}
beforeEach(() => {
  vi.mocked(authorized).mockReset();
  vi.mocked(authorized).mockResolvedValue(page());
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("NotificationsArea", () => {
  it("loads once using the protected no-store GET, without mutation or polling", async () => {
    view();
    await screen.findByRole("button", { name: "Ver pedido #42" });
    expect(authorized).toHaveBeenCalledTimes(1);
    expect(authorized).toHaveBeenCalledWith(
      "/notifications?limit=20",
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(
      screen.getByRole("heading", { name: "Atualizações da sua conta" })
        .tagName,
    ).toBe("H3");
    expect(screen.getByText(/são um histórico/)).toBeTruthy();
    expect(document.querySelector("time")?.dateTime).toBe(
      "2026-10-23T18:00:00.000Z",
    );
  });
  it("shows a useful empty state without unread counts", async () => {
    vi.mocked(authorized).mockResolvedValue(page([]));
    view();
    expect(
      await screen.findByText(/Você ainda não tem atualizações/),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Carregar mais notificações" }),
    ).toBeNull();
    expect(screen.queryByText(/não lidas/i)).toBeNull();
  });
  it("renders server strings as plain escaped text", async () => {
    vi.mocked(authorized).mockResolvedValue(
      page([
        item("ORDER_CREATED", {
          title: "<img src=x onerror=alert(1)>",
          message: "<script>private()</script>",
        }),
      ]),
    );
    view();
    expect(
      await screen.findByText("<img src=x onerror=alert(1)>"),
    ).toBeTruthy();
    expect(document.querySelector("img,script")).toBeNull();
    expect(screen.getByText("<script>private()</script>")).toBeTruthy();
  });
  it("passes an opaque encoded cursor and merges duplicate events chronologically", async () => {
    const paid = item("ORDER_PAID", {
      title: "Pagamento recebido",
      occurredAt: "2026-10-23T19:00:00.000Z",
    });
    vi.mocked(authorized)
      .mockResolvedValueOnce(page([paid], "opaque+/=?:&"))
      .mockResolvedValueOnce(page([paid, item()]));
    view();
    fireEvent.click(
      await screen.findByRole("button", { name: "Carregar mais notificações" }),
    );
    await screen.findByRole("heading", { name: "Pedido criado" });
    expect(authorized).toHaveBeenLastCalledWith(
      "/notifications?limit=20&cursor=opaque%2B%2F%3D%3F%3A%26",
      expect.anything(),
    );
    const headings = [...document.querySelectorAll("li h4")].map(
      (el) => el.textContent,
    );
    expect(headings).toEqual(["Pagamento recebido", "Pedido criado"]);
  });
  it("prevents duplicate load-more requests while preserving existing events", async () => {
    const pending = deferred<unknown>();
    vi.mocked(authorized)
      .mockResolvedValueOnce(page([item()], "page2"))
      .mockReturnValueOnce(pending.promise);
    view();
    const more = await screen.findByRole("button", {
      name: "Carregar mais notificações",
    });
    fireEvent.click(more);
    fireEvent.click(more);
    expect(authorized).toHaveBeenCalledTimes(2);
    expect(more.hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("heading", { name: "Pedido criado" })).toBeTruthy();
    await act(async () => pending.resolve(page([])));
  });
  it("retains previous items on page failure and retries the same cursor manually", async () => {
    vi.mocked(authorized)
      .mockResolvedValueOnce(page([item()], "page2"))
      .mockRejectedValueOnce(new Error("DATABASE_PASSWORD private failure"))
      .mockResolvedValueOnce(
        page([item("ORDER_PAID", { title: "Pagamento recebido" })]),
      );
    view();
    fireEvent.click(
      await screen.findByRole("button", { name: "Carregar mais notificações" }),
    );
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Não foi possível carregar as notificações. Tente novamente.",
    );
    expect(screen.getByRole("heading", { name: "Pedido criado" })).toBeTruthy();
    expect(screen.queryByText(/DATABASE_PASSWORD/)).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Carregar mais notificações" }),
    );
    await screen.findByRole("heading", { name: "Pagamento recebido" });
    expect(
      vi
        .mocked(authorized)
        .mock.calls.slice(1)
        .map(([path]) => path),
    ).toEqual([
      "/notifications?limit=20&cursor=page2",
      "/notifications?limit=20&cursor=page2",
    ]);
  });
  it("restarts from the first page on explicit refresh", async () => {
    vi.mocked(authorized)
      .mockResolvedValueOnce(page([item()], "page2"))
      .mockResolvedValueOnce(
        page([item("ORDER_PAID", { title: "Novo marco" })]),
      );
    view();
    await screen.findByRole("heading", { name: "Pedido criado" });
    fireEvent.click(
      screen.getByRole("button", { name: "Atualizar notificações" }),
    );
    await screen.findByRole("heading", { name: "Novo marco" });
    expect(screen.queryByRole("heading", { name: "Pedido criado" })).toBeNull();
    expect(authorized).toHaveBeenLastCalledWith(
      "/notifications?limit=20",
      expect.anything(),
    );
  });
  it("discards a stale first-page response after refresh even if abort is ignored", async () => {
    const old = deferred<unknown>();
    vi.mocked(authorized)
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(
        page([item("ORDER_PAID", { title: "Resposta atual" })]),
      );
    view();
    fireEvent.click(
      screen.getByRole("button", { name: "Atualizar notificações" }),
    );
    await screen.findByRole("heading", { name: "Resposta atual" });
    await act(async () => old.resolve(page()));
    expect(screen.queryByRole("heading", { name: "Pedido criado" })).toBeNull();
    expect(vi.mocked(authorized).mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
  it("discards a stale load-more response after refresh", async () => {
    const old = deferred<unknown>();
    vi.mocked(authorized)
      .mockResolvedValueOnce(page([item()], "page2"))
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(
        page([item("SHIPMENT_CREATED", { title: "Atualização atual" })]),
      );
    view();
    fireEvent.click(
      await screen.findByRole("button", { name: "Carregar mais notificações" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Atualizar notificações" }),
    );
    await screen.findByRole("heading", { name: "Atualização atual" });
    await act(async () =>
      old.resolve(page([item("ORDER_PAID", { title: "Resposta antiga" })])),
    );
    expect(
      screen.queryByRole("heading", { name: "Resposta antiga" }),
    ).toBeNull();
  });
  it("rejects a repeated pagination cursor without losing prior events", async () => {
    vi.mocked(authorized)
      .mockResolvedValueOnce(page([item()], "same"))
      .mockResolvedValueOnce(
        page([item("ORDER_PAID", { title: "Invalid page" })], "same"),
      );
    view();
    fireEvent.click(
      await screen.findByRole("button", { name: "Carregar mais notificações" }),
    );
    await screen.findByRole("alert");
    expect(screen.queryByRole("heading", { name: "Invalid page" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Pedido criado" })).toBeTruthy();
  });
  it.each([
    {},
    page([{ ...item(), occurredAt: "invalid" }]),
    page([item()], "x".repeat(513)),
  ])("sanitizes malformed responses", async (bad) => {
    vi.mocked(authorized).mockResolvedValue(bad);
    view();
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Não foi possível carregar as notificações. Tente novamente.",
    );
    expect(screen.queryByRole("button", { name: /Ver pedido/ })).toBeNull();
  });
  it("clears existing data after forbidden access and prevents further requests", async () => {
    vi.mocked(authorized)
      .mockResolvedValueOnce(page([item()], "page2"))
      .mockRejectedValueOnce(
        Object.assign(new Error("private"), { status: 403 }),
      );
    view();
    fireEvent.click(
      await screen.findByRole("button", { name: "Carregar mais notificações" }),
    );
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Não foi possível acessar as notificações desta conta. Entre novamente.",
    );
    expect(screen.queryByRole("heading", { name: "Pedido criado" })).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Atualizar notificações" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });
  it("aborts and ignores responses after unmount", async () => {
    const pending = deferred<unknown>();
    vi.mocked(authorized).mockReturnValue(pending.promise);
    const result = view();
    result.unmount();
    expect(vi.mocked(authorized).mock.calls[0][1]?.signal?.aborted).toBe(true);
    await act(async () => pending.resolve(page()));
    expect(document.querySelector(".notification-list")).toBeNull();
  });
  it("does not render or apply a response once the session changes", async () => {
    const pending = deferred<unknown>();
    let active = true;
    const session = () => active;
    vi.mocked(authorized).mockReturnValue(pending.promise);
    const result = view({ isCurrentSession: session });
    active = false;
    result.rerender(
      <NotificationsArea isCurrentSession={session} onOpenTarget={nothing} />,
    );
    await act(async () => pending.resolve(page()));
    expect(screen.queryByRole("heading", { name: "Pedido criado" })).toBeNull();
    expect(authorized).toHaveBeenCalledTimes(1);
  });
  it("uses the latest session callback before accepting a response", async () => {
    const pending = deferred<unknown>();
    vi.mocked(authorized).mockReturnValue(pending.promise);
    const result = view();
    result.rerender(
      <NotificationsArea
        isCurrentSession={() => false}
        onOpenTarget={nothing}
      />,
    );
    await act(async () => pending.resolve(page()));
    expect(screen.queryByRole("heading", { name: "Pedido criado" })).toBeNull();
  });
  it("ends an unresponsive request at 15 seconds even if it ignores abort", async () => {
    vi.useFakeTimers();
    vi.mocked(authorized).mockReturnValue(new Promise(() => {}));
    view();
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(screen.getByRole("alert")).toHaveProperty(
      "textContent",
      "Não foi possível carregar as notificações. Tente novamente.",
    );
    expect(screen.queryByText("Carregando notificações…")).toBeNull();
    expect(vi.mocked(authorized).mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
  it("opens the exact order target and blocks duplicate clicks until settled", async () => {
    const pending = deferred<void>();
    const open = vi.fn().mockReturnValue(pending.promise);
    view({ onOpenTarget: open });
    const button = await screen.findByRole("button", {
      name: "Ver pedido #42",
    });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(open).toHaveBeenCalledExactlyOnceWith({
      type: "order",
      id: orderId,
    });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(
      screen
        .getByRole("button", { name: "Atualizar notificações" })
        .hasAttribute("disabled"),
    ).toBe(true);
    await act(async () => pending.resolve());
    expect(button.hasAttribute("disabled")).toBe(false);
    expect(authorized).toHaveBeenCalledTimes(1);
  });
  it("opens shipment targets through the parent callback", async () => {
    vi.mocked(authorized).mockResolvedValue(
      page([item("SHIPMENT_SHIPPED", { title: "Envio postado" })]),
    );
    const open = vi.fn().mockResolvedValue(undefined);
    view({ onOpenTarget: open });
    fireEvent.click(await screen.findByRole("button", { name: "Ver envio" }));
    await waitFor(() =>
      expect(open).toHaveBeenCalledExactlyOnceWith({
        type: "shipment",
        id: shipmentId,
      }),
    );
  });
  it("shows a safe error and allows retry after target opening fails", async () => {
    const open = vi.fn().mockRejectedValue(new Error("secret response"));
    view({ onOpenTarget: open });
    fireEvent.click(
      await screen.findByRole("button", { name: "Ver pedido #42" }),
    );
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Não foi possível abrir este detalhe. Tente novamente.",
    );
    expect(screen.queryByText(/secret response/)).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Ver pedido #42" })
        .hasAttribute("disabled"),
    ).toBe(false);
  });
  it("does not load anything for an invalid initial session", () => {
    view({ isCurrentSession: () => false });
    expect(authorized).not.toHaveBeenCalled();
    expect(document.querySelector(".notifications-area")).toBeNull();
  });
});
