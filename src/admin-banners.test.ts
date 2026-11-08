// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bannerDraft,
  changedBannerFields,
  inspectBannerImage,
  validateBanner,
  validateBannerFile,
} from "./admin-banners";
import type { AdminBanner } from "./admin-banners";

const banner: AdminBanner = {
  id: "banner-id",
  title: "Novidades",
  link: "/catalogo",
  active: false,
  sortOrder: 7,
  createdAt: "2026-10-22T00:00:00.000Z",
  updatedAt: "2026-10-22T00:00:00.000Z",
  imageUrl: "/banners/banner-id/image?v=123",
};

describe("Banner metadata", () => {
  it("creates an empty draft and preserves disabled banner metadata", () => {
    expect(bannerDraft()).toEqual({ title: "", link: "", active: false, sortOrder: "0" });
    expect(bannerDraft(banner)).toEqual({ title: "Novidades", link: "/catalogo", active: false, sortOrder: "7" });
    expect(bannerDraft({ ...banner, link: null }).link).toBe("");
  });
  it("normalizes title, empty links and integer ordering without copying other fields", () => {
    expect(validateBanner({ ...bannerDraft(), title: "  Novidades  ", sortOrder: " 123 " })).toEqual({
      errors: {},
      input: { title: "Novidades", link: null, active: false, sortOrder: 123 },
    });
  });
  it.each(["", "   ", "a".repeat(121)])("rejects invalid title %j", (title) => {
    const validated = validateBanner({ ...bannerDraft(banner), title });
    expect(validated.errors.title).toBeTruthy();
    expect(validated.input).toBeUndefined();
  });
  it("accepts exact maximum lengths and ordering", () => {
    const validated = validateBanner({ ...bannerDraft(banner), title: "a".repeat(120), link: `/${"a".repeat(499)}`, sortOrder: "999999" });
    expect(validated.errors).toEqual({});
    expect(validated.input?.sortOrder).toBe(999999);
  });
  it.each([
    "https://example.com", "//example.com", "catalogo", "javascript:alert(1)",
    "/\\example.com", "/catalogo com espaço", "/catalogo%2fitem", "/catalogo\titem",
    "/catalogo\nitem", "/catalogo\u0000item", "/catalogo\u001fitem", "/\u00a0item",
    " /catalogo", "/catalogo ", `/${"a".repeat(500)}`,
  ])("rejects unsafe or oversized link %j", (link) => {
    const validated = validateBanner({ ...bannerDraft(banner), link });
    expect(validated.errors.link).toBeTruthy();
    expect(validated.input).toBeUndefined();
  });
  it.each(["/", "/catalogo", "/catalogo?category=cards&sort=price", "/catalogo#cartas"])("accepts internal link %j", (link) => {
    expect(validateBanner({ ...bannerDraft(banner), link }).input?.link).toBe(link);
  });
  it.each(["", "-1", "1.5", "1e2", "+1", "01", "1000000", "Infinity", "1,000"])("rejects invalid order %j", (sortOrder) => {
    const validated = validateBanner({ ...bannerDraft(banner), sortOrder });
    expect(validated.errors.sortOrder).toBeTruthy();
    expect(validated.input).toBeUndefined();
  });
  it("rejects a non-boolean active value", () => {
    expect(validateBanner({ ...bannerDraft(banner), active: "true" as unknown as boolean }).errors.active).toBeTruthy();
  });
  it("returns only changed editable fields, including explicit null and false", () => {
    const input = { title: "Novidades", link: "/catalogo", active: false, sortOrder: 7 };
    expect(changedBannerFields(banner, input)).toEqual({});
    expect(changedBannerFields({ ...banner, active: true }, { ...input, title: "Promoções", link: null, sortOrder: 0 })).toEqual({
      title: "Promoções", link: null, active: false, sortOrder: 0,
    });
    expect(changedBannerFields(banner, { ...input, imageUrl: "bad", id: "bad", updatedAt: "bad" } as typeof input)).toEqual({});
  });
});

function file(type = "image/png", bytes: number = 20) {
  return new File([new Uint8Array(bytes)], "banner.png", { type });
}
describe("Banner image selection", () => {
  it("requires a nonempty file and limits size to 5 MB", () => {
    expect(validateBannerFile(null)).toBeTruthy();
    expect(validateBannerFile(file("image/png", 0))).toBeTruthy();
    expect(validateBannerFile(file("image/png", 5 * 1024 * 1024))).toBeNull();
    expect(validateBannerFile(file("image/png", 5 * 1024 * 1024 + 1))).toBeTruthy();
  });
  it.each(["image/png", "image/jpeg", "image/webp"])("accepts supported type %s", (type) => {
    expect(validateBannerFile(file(type))).toBeNull();
  });
  it.each(["", "image/gif", "image/svg+xml", "text/html", "application/octet-stream"])("rejects unsupported type %s", (type) => {
    expect(validateBannerFile(file(type))).toBeTruthy();
  });
});

class ImageStub {
  naturalWidth = 1600;
  naturalHeight = 500;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src = "";
}
let images: ImageStub[];
let createUrl = vi.fn<(value: Blob | MediaSource) => string>();
let revokeUrl = vi.fn<(value: string) => void>();
beforeEach(() => {
  images = [];
  createUrl = vi.fn<(value: Blob | MediaSource) => string>().mockReturnValue("blob:banner-preview");
  revokeUrl = vi.fn<(value: string) => void>();
  vi.stubGlobal("Image", class extends ImageStub {
    constructor() {
      super();
      images.push(this);
    }
  });
  const OriginalUrl = URL;
  vi.stubGlobal("URL", class extends OriginalUrl {
    static createObjectURL(value: Blob | MediaSource): string { return createUrl(value) as string; }
    static revokeObjectURL(value: string): void { revokeUrl(value); }
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("Banner image inspection", () => {
  it("loads the local object URL and revokes it after correct dimensions", async () => {
    const input = file();
    const inspection = inspectBannerImage(input);
    expect(createUrl).toHaveBeenCalledWith(input);
    expect(images[0].src).toBe("blob:banner-preview");
    images[0].onload?.();
    await expect(inspection).resolves.toBeUndefined();
    expect(revokeUrl).toHaveBeenCalledExactlyOnceWith("blob:banner-preview");
    expect(images[0].onload).toBeNull();
    expect(images[0].onerror).toBeNull();
    expect(images[0].src).toBe("");
  });
  it.each([[1599, 500], [1600, 501], [0, 0]])("rejects dimensions %s × %s and cleans the URL", async (width, height) => {
    const inspection = inspectBannerImage(file());
    images[0].naturalWidth = width;
    images[0].naturalHeight = height;
    images[0].onload?.();
    await expect(inspection).rejects.toThrow("1600 × 500");
    expect(revokeUrl).toHaveBeenCalledTimes(1);
  });
  it("rejects decode errors without exposing browser details", async () => {
    const inspection = inspectBannerImage(file());
    images[0].onerror?.();
    await expect(inspection).rejects.toThrow("Não foi possível ler a imagem.");
    expect(revokeUrl).toHaveBeenCalledTimes(1);
  });
  it("cleans up the object URL and handlers when aborted", async () => {
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    const inspection = inspectBannerImage(file(), controller.signal);
    const oldLoad = images[0].onload;
    controller.abort("secret browser details");
    await expect(inspection).rejects.toThrow("Verificação da imagem cancelada.");
    oldLoad?.();
    expect(revokeUrl).toHaveBeenCalledTimes(1);
    expect(images[0].onload).toBeNull();
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
  });
  it("does not create an object URL when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(inspectBannerImage(file(), controller.signal)).rejects.toThrow("cancelada");
    expect(createUrl).not.toHaveBeenCalled();
  });
  it("times out after 15 seconds and revokes the URL", async () => {
    vi.useFakeTimers();
    const inspection = inspectBannerImage(file());
    const assertion = expect(inspection).rejects.toThrow("demorou demais");
    await vi.advanceTimersByTimeAsync(15000);
    await assertion;
    expect(revokeUrl).toHaveBeenCalledTimes(1);
    expect(images[0].onload).toBeNull();
  });
  it("clears its timeout after success", async () => {
    vi.useFakeTimers();
    const inspection = inspectBannerImage(file());
    images[0].onload?.();
    await inspection;
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(15000);
    expect(revokeUrl).toHaveBeenCalledTimes(1);
  });
  it("rejects invalid files before creating a URL", async () => {
    await expect(inspectBannerImage(file("image/svg+xml"))).rejects.toThrow("PNG, JPEG ou WebP");
    expect(createUrl).not.toHaveBeenCalled();
  });
  it("handles object URL failures using a safe message", async () => {
    createUrl.mockImplementationOnce(() => { throw new Error("sensitive browser detail"); });
    await expect(inspectBannerImage(file())).rejects.toThrow("Não foi possível ler a imagem.");
    expect(revokeUrl).not.toHaveBeenCalled();
  });
});
