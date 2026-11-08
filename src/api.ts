export interface Product {
  id: string;
  price: string;
  observation: string | null;
  availableQuantity: number;
  inStock: boolean;
  card: {
    name: string;
    number: string;
    rarity: string | null;
    artist: string | null;
    imageSmall: string | null;
    imageLarge: string | null;
    set: { name: string };
  };
  condition: { name: string };
  language: { name: string };
}
export interface Banner {
  id: string;
  title: string;
  imageUrl: string;
  link: string | null;
}
export interface Filters {
  categories: { id: string; name: string }[];
  conditions: { id: string; name: string }[];
  languages: { id: string; name: string }[];
  rarities: string[];
}
export const base = import.meta.env.VITE_API_BASE_URL || "/api";
export const imageUrl = (url: string) =>
  url.startsWith("/") ? `${base}${url}` : url;
export async function api<T>(path: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(`${base}${path}`, { signal });
  if (!r.ok) {
    const b = await r.json().catch(() => ({}));
    throw new Error(
      typeof b.message === "string"
        ? b.message
        : "Não foi possível carregar. Tente novamente.",
    );
  }
  return r.json();
}
export const money = (v: string) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    Number(v),
  );
