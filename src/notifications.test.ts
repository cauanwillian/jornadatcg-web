import { describe, expect, it } from "vitest";
import {
  mergeNotifications,
  notificationKinds,
  parseNotificationsPage,
  validNotificationCursor,
  type JourneyNotification,
} from "./notifications";

const orderId = "68a7b7af-18a9-46ab-b44d-a7438cbb5c02";
function item(): JourneyNotification {
  return {
    id: `ORDER_CREATED:${orderId}`,
    kind: "ORDER_CREATED",
    occurredAt: "2026-10-23T18:00:00.000Z",
    title: "Pedido criado",
    message: "Seu pedido #42 foi criado.",
    target: { type: "order", id: orderId },
    orderNumber: 42,
  };
}
const page = (changes = {}) => ({
  items: [item()],
  nextCursor: null,
  hasMore: false,
  ...changes,
});
describe("notification response contract", () => {
  it("normalizes the allowed response fields", () => {
    const value = page();
    Object.assign(value.items[0], {
      secret: "internal",
      target: { ...value.items[0].target, requestSnapshot: "internal" },
    });
    expect(parseNotificationsPage(value)).toEqual(page());
  });
  it.each(Object.keys(notificationKinds))(
    "accepts known kind %s and the corresponding target",
    (kind) => {
      const value = item();
      Object.assign(value, {
        kind,
        id: `${kind}:${orderId}`,
        target: {
          id: orderId,
          type: kind.startsWith("ORDER_") ? "order" : "shipment",
        },
      });
      expect(
        parseNotificationsPage(page({ items: [value] })).items[0].kind,
      ).toBe(kind);
    },
  );
  it.each([
    null,
    {},
    { items: null },
    page({ items: Array.from({ length: 21 }, item) }),
    page({ hasMore: true }),
    page({ hasMore: false, nextCursor: "opaque" }),
    page({ hasMore: "true" }),
    page({ hasMore: true, nextCursor: "x".repeat(513) }),
    page({ hasMore: true, nextCursor: "\nprivate" }),
  ])("rejects an invalid page envelope", (value) => {
    expect(() => parseNotificationsPage(value)).toThrow(
      "Resposta de notificações inválida.",
    );
  });
  it.each([
    { kind: "INTERNAL_EVENT" },
    { kind: "toString" },
    { id: "ORDER_CREATED:invalid" },
    { target: { type: "shipment", id: orderId } },
    { target: { type: "order", id: "bad" } },
    { occurredAt: "not a date" },
    { occurredAt: "2026-02-31T18:00:00.000Z" },
    { title: "" },
    { title: "x".repeat(201) },
    { message: 9 },
    { message: "x".repeat(1001) },
    { orderNumber: 0 },
    { orderNumber: 1.2 },
    { orderNumber: Number.MAX_SAFE_INTEGER + 1 },
  ])("rejects malformed events before rendering", (change) => {
    expect(() =>
      parseNotificationsPage(page({ items: [{ ...item(), ...change }] })),
    ).toThrow();
  });
  it("allows an absent order number", () => {
    const value = item();
    delete value.orderNumber;
    expect(
      parseNotificationsPage(page({ items: [value] })).items[0].orderNumber,
    ).toBeUndefined();
  });
  it("treats cursor as an opaque bounded value", () => {
    const cursor = "opaque+/=?:&";
    expect(validNotificationCursor(cursor)).toBe(true);
    expect(
      parseNotificationsPage(page({ hasMore: true, nextCursor: cursor }))
        .nextCursor,
    ).toBe(cursor);
    expect(validNotificationCursor(" ")).toBe(false);
    expect(validNotificationCursor(" padded")).toBe(false);
    expect(validNotificationCursor("unpaired\ud800")).toBe(false);
  });
  it("deduplicates milestones while preserving different milestones for the same target", () => {
    const first = item();
    const paid = {
      ...first,
      id: `ORDER_PAID:${orderId}`,
      kind: "ORDER_PAID" as const,
      occurredAt: "2026-10-23T19:00:00.000Z",
    };
    expect(mergeNotifications([first], [first, paid])).toEqual([paid, first]);
  });
});
