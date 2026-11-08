// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import App from "./App";
import * as client from "./api";
import type { Product } from "./api";

vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  api: vi.fn(),
}));
vi.mock("./Shop", () => ({
  AccountActions: () => null,
  AddButton: () => null,
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const card = (id: string, name: string, price: string): Product => ({
  id,
  price,
  observation: null,
  availableQuantity: 3,
  inStock: true,
  card: {
    name,
    number: "001",
    rarity: null,
    artist: null,
    imageSmall: null,
    imageLarge: null,
    set: { name: "Coleção de teste" },
  },
  condition: { name: "NM" },
  language: { name: "Português" },
});
it("reloads the catalog from page one after an administrative change", async () => {
  let changed = false;
  vi.mocked(client.api).mockImplementation(async (path) => {
    if (path === "/catalog/filters")
      return { categories: [], conditions: [], languages: [], rarities: [] };
    if (path === "/banners" || path === "/catalog/featured")
      return { data: [] };
    if (path.startsWith("/catalog/products?")) {
      const page = new URLSearchParams(path.split("?")[1]).get("page");
      return {
        data: changed
          ? [card("new", "Carta atualizada", "30.00")]
          : [card(page!, `Carta da página ${page}`, "10.00")],
        pagination: {
          total: changed ? 1 : 25,
          hasMore: !changed && page === "1",
        },
      };
    }
    throw new Error("Unexpected route");
  });
  const { unmount } = render(<App />);
  await screen.findByText("Carta da página 1");
  fireEvent.click(screen.getByRole("button", { name: /Carregar mais/ }));
  await screen.findByText("Carta da página 2");
  changed = true;
  const before = vi.mocked(client.api).mock.calls.length;
  act(() => window.dispatchEvent(new Event("jornada-catalog-changed")));
  await screen.findByText("Carta atualizada");
  expect(screen.queryByText("Carta da página 1")).toBeNull();
  expect(screen.queryByText("Carta da página 2")).toBeNull();
  expect(
    vi
      .mocked(client.api)
      .mock.calls.slice(before)
      .some(([path]) => path.includes("/catalog/products?page=1&")),
  ).toBe(true);
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: /Carregar mais/ })).toBeNull(),
  );
  unmount();
  const calls = vi.mocked(client.api).mock.calls.length;
  act(() => window.dispatchEvent(new Event("jornada-catalog-changed")));
  expect(client.api).toHaveBeenCalledTimes(calls);
});
it("refreshes the public carousel after a banner management change", async () => {
  let changed = false;
  vi.mocked(client.api).mockImplementation(async (path) => {
    if (path === "/catalog/filters")
      return { categories: [], conditions: [], languages: [], rarities: [] };
    if (path === "/catalog/featured") return { data: [] };
    if (path === "/banners")
      return {
        data: [
          {
            id: changed ? "new" : "old",
            title: changed ? "Banner atualizado" : "Banner anterior",
            imageUrl: changed
              ? "/banners/new/image?v=2"
              : "/banners/old/image?v=1",
            link: "/#catalogo",
          },
        ],
      };
    if (path.startsWith("/catalog/products?"))
      return { data: [], pagination: { total: 0, hasMore: false } };
    throw new Error("Unexpected route");
  });
  render(<App />);
  await screen.findByAltText("Banner anterior");
  changed = true;
  act(() => window.dispatchEvent(new Event("jornada-catalog-changed")));
  const banner = await screen.findByAltText("Banner atualizado");
  expect(banner.getAttribute("src")).toBe("/api/banners/new/image?v=2");
  expect(screen.queryByAltText("Banner anterior")).toBeNull();
});
