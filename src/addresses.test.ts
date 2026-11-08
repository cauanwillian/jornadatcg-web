// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authorized } from "./session";
import {
  addressBody,
  addressToDraft,
  createAddress,
  deleteAddress,
  emptyAddressDraft,
  fetchAddress,
  fetchAddresses,
  formatAddressZip,
  replaceAddress,
  validateAddressDraft,
} from "./addresses";
import type { AddressDraft } from "./addresses";
import type { Address } from "./ShippingAddresses";

vi.mock("./session", () => ({ authorized: vi.fn() }));
const id = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const draft: AddressDraft = {
  label: " Casa ",
  recipientName: " Pessoa de teste ",
  zipCode: "78000-000",
  street: " Rua de teste ",
  number: " s/n ",
  complement: " ",
  neighborhood: " Centro ",
  city: " Cuiabá ",
  state: " mt ",
  isDefault: false,
};
const body = {
  label: "Casa",
  recipientName: "Pessoa de teste",
  zipCode: "78000000",
  street: "Rua de teste",
  number: "s/n",
  complement: null,
  neighborhood: "Centro",
  city: "Cuiabá",
  state: "MT",
  isDefault: false,
};
const row: Address = {
  ...body,
  id,
  isDefault: true,
  createdAt: "2026-10-24T12:00:00.000Z",
  updatedAt: "2026-10-24T12:00:00.000Z",
};
beforeEach(() => {
  vi.mocked(authorized).mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});
describe("address validation", () => {
  it("normalizes the documented body without metadata", () => {
    expect(validateAddressDraft(draft)).toEqual({ errors: {}, input: body });
    expect(addressBody({ ...row, unexpected: "private" } as Address)).toEqual({
      ...body,
      isDefault: true,
    });
  });
  it("creates independent empty drafts and preserves editable fields", () => {
    const first = emptyAddressDraft();
    first.city = "Changed";
    expect(emptyAddressDraft().city).toBe("");
    expect(addressToDraft(row)).toEqual({
      ...body,
      complement: "",
      zipCode: "78000-000",
      isDefault: true,
    });
    expect(formatAddressZip("78000-000")).toBe("78000-000");
    expect(formatAddressZip("bad")).toBe("bad");
  });
  it.each([
    "recipientName",
    "street",
    "number",
    "neighborhood",
    "city",
  ] as const)("requires %s", (field) => {
    const result = validateAddressDraft({ ...draft, [field]: " " });
    expect(result.errors[field]).toBeTruthy();
    expect(result.input).toBeUndefined();
  });
  it.each([
    ["label", 60],
    ["recipientName", 120],
    ["street", 200],
    ["number", 20],
    ["complement", 120],
    ["neighborhood", 120],
    ["city", 120],
  ] as const)("enforces %s length after trimming", (field, max) => {
    expect(
      validateAddressDraft({ ...draft, [field]: "x".repeat(max) }).input,
    ).toBeTruthy();
    expect(
      validateAddressDraft({ ...draft, [field]: "x".repeat(max + 1) }).errors[
        field
      ],
    ).toBeTruthy();
  });
  it.each(["\nCentro", "Centro\u0000", "Centro\u007f", "Centro\t"])(
    "rejects control characters",
    (value) => {
      expect(
        validateAddressDraft({ ...draft, neighborhood: value }).errors
          .neighborhood,
      ).toBeTruthy();
    },
  );
  it.each([
    "7800000",
    "780000000",
    "78000a00",
    "78000/000",
    "78000--000",
    "78000-000\n",
  ])("rejects invalid zip %s", (zipCode) => {
    expect(
      validateAddressDraft({ ...draft, zipCode }).errors.zipCode,
    ).toBeTruthy();
  });
  it("accepts optional fields and rejects invalid UF or nonboolean defaults", () => {
    expect(
      validateAddressDraft({ ...draft, label: "", complement: "" }).input,
    ).toMatchObject({ label: null, complement: null });
    expect(
      validateAddressDraft({ ...draft, state: "XX" }).errors.state,
    ).toBeTruthy();
    expect(
      validateAddressDraft({ ...draft, state: "MT\n" }).errors.state,
    ).toBeTruthy();
    expect(
      validateAddressDraft({
        ...draft,
        isDefault: "true" as unknown as boolean,
      }).errors.isDefault,
    ).toBeTruthy();
  });
});
describe("address requests", () => {
  it("loads an array with protected no-store GET and keeps only public DTO fields", async () => {
    vi.mocked(authorized).mockResolvedValue([
      { ...row, userId: "private", secret: "hidden" },
    ]);
    const controller = new AbortController();
    expect(await fetchAddresses(controller)).toEqual([row]);
    expect(authorized).toHaveBeenCalledWith("/addresses", {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    vi.mocked(authorized).mockResolvedValue([]);
    expect(await fetchAddresses(new AbortController())).toEqual([]);
  });
  it.each([
    { items: [] },
    null,
    Array.from({ length: 21 }, () => row),
    [row, row],
    [row, { ...row, id: other }],
    [{ ...row, id: "invalid" }],
    [{ ...row, zipCode: "78000-000" }],
    [{ ...row, state: "mt" }],
    [{ ...row, recipientName: "" }],
    [{ ...row, street: "\nPrivate" }],
    [{ ...row, label: "" }],
    [{ ...row, complement: undefined }],
    [{ ...row, isDefault: "true" }],
    [{ ...row, createdAt: "2026-02-30T00:00:00.000Z" }],
    [{ ...row, updatedAt: null }],
  ])("rejects invalid list DTO %#", async (value) => {
    vi.mocked(authorized).mockResolvedValue(value);
    await expect(fetchAddresses(new AbortController())).rejects.toThrow();
  });
  it("loads a matching detail and rejects a mismatched or invalid id", async () => {
    vi.mocked(authorized).mockResolvedValue(row);
    expect(await fetchAddress(id, new AbortController())).toEqual(row);
    expect(authorized).toHaveBeenCalledWith(
      `/addresses/${id}`,
      expect.objectContaining({ method: "GET" }),
    );
    vi.mocked(authorized).mockResolvedValue({ ...row, id: other });
    await expect(fetchAddress(id, new AbortController())).rejects.toThrow();
    vi.mocked(authorized).mockClear();
    await expect(
      fetchAddress("bad/path", new AbortController()),
    ).rejects.toThrow();
    expect(authorized).not.toHaveBeenCalled();
  });
  it("POSTs normalized documented fields and accepts the server's first-address default", async () => {
    vi.mocked(authorized).mockResolvedValue(row);
    expect(
      await createAddress(
        {
          ...body,
          recipientName: " Pessoa de teste ",
          unexpected: "secret",
        } as typeof body,
        new AbortController(),
      ),
    ).toEqual(row);
    const [path, options] = vi.mocked(authorized).mock.calls[0];
    expect(path).toBe("/addresses");
    expect(options?.method).toBe("POST");
    expect(JSON.parse(options!.body as string)).toEqual(body);
  });
  it("PUTs a complete body and preserves omission of the principal flag", async () => {
    vi.mocked(authorized).mockResolvedValue(row);
    const { isDefault: _isDefault, ...input } = body;
    await replaceAddress(id, input, new AbortController());
    const [path, options] = vi.mocked(authorized).mock.calls[0];
    expect(path).toBe(`/addresses/${id}`);
    expect(options?.method).toBe("PUT");
    expect(JSON.parse(options!.body as string)).toEqual(input);
    vi.mocked(authorized).mockResolvedValue({ ...row, id: other });
    await expect(
      replaceAddress(id, body, new AbortController()),
    ).rejects.toThrow();
  });
  it("rejects invalid write bodies before issuing a request", async () => {
    await expect(
      createAddress({ ...body, zipCode: "letters" }, new AbortController()),
    ).rejects.toThrow();
    expect(authorized).not.toHaveBeenCalled();
  });
  it("accepts DELETE 204 without parsing JSON and rejects unexpected response bodies", async () => {
    vi.mocked(authorized).mockResolvedValue(undefined);
    await expect(
      deleteAddress(id, new AbortController()),
    ).resolves.toBeUndefined();
    expect(authorized).toHaveBeenCalledWith(
      `/addresses/${id}`,
      expect.objectContaining({ method: "DELETE", cache: "no-store" }),
    );
    vi.mocked(authorized).mockResolvedValue({});
    await expect(deleteAddress(id, new AbortController())).rejects.toThrow();
  });
  it("preserves HTTP error status for the caller without retrying writes", async () => {
    const failure = Object.assign(new Error("unsafe provider text"), {
      status: 409,
    });
    vi.mocked(authorized).mockRejectedValue(failure);
    await expect(replaceAddress(id, body, new AbortController())).rejects.toBe(
      failure,
    );
    expect(authorized).toHaveBeenCalledTimes(1);
  });
  it.each(["read", "create", "replace", "delete"])(
    "bounds %s to 15 seconds even if transport ignores abort",
    async (operation) => {
      vi.useFakeTimers();
      vi.mocked(authorized).mockReturnValue(new Promise(() => {}));
      const controller = new AbortController();
      const pending =
        operation === "read"
          ? fetchAddresses(controller)
          : operation === "create"
            ? createAddress(body, controller)
            : operation === "replace"
              ? replaceAddress(id, body, controller)
              : deleteAddress(id, controller);
      const rejected = expect(pending).rejects.toThrow("interrompida");
      await vi.advanceTimersByTimeAsync(15000);
      await rejected;
      expect(controller.signal.aborted).toBe(true);
      expect(authorized).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it("aborts immediately and makes no request for an already aborted controller", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(fetchAddresses(controller)).rejects.toThrow();
    expect(authorized).not.toHaveBeenCalled();
  });
  it("aborts a pending read immediately and clears its deadline", async () => {
    vi.useFakeTimers();
    vi.mocked(authorized).mockReturnValue(new Promise(() => {}));
    const controller = new AbortController();
    const pending = fetchAddresses(controller);
    const rejected = expect(pending).rejects.toThrow();
    controller.abort();
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });
});
