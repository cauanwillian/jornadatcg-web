export interface AdminProduct {
  id: string;
  price: string;
  observation: string | null;
  active: boolean;
  featured: boolean;
  featuredOrder: number;
  createdAt: string;
  updatedAt: string;
  card: {
    id: string;
    externalId: string;
    name: string;
    number: string;
    imageSmall: string | null;
    imageLarge: string | null;
    set: { id: string; name: string; externalId: string };
  };
  category: { id: string; name: string; slug: string; active: boolean };
  condition: { id: string; name: string; code: string; active: boolean };
  language: { id: string; name: string; code: string; active: boolean };
  inventory: {
    availableQuantity: number;
    reservedQuantity: number;
    soldQuantity: number;
    updatedAt: string;
  } | null;
}

export interface ProductOptions {
  categories: Array<{
    id: string;
    name: string;
    slug: string;
    description: string | null;
  }>;
  conditions: Array<{
    id: string;
    name: string;
    code: string;
    description: string | null;
  }>;
  languages: Array<{ id: string; name: string; code: string }>;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface AdminProductsPage {
  data: AdminProduct[];
  pagination: Pagination;
}

export interface LocalCard {
  id: string;
  externalId: string;
  name: string;
  number: string;
  rarity: string | null;
  artist: string | null;
  images: { small: string | null; large: string | null };
  set: {
    id: string;
    externalId: string;
    name: string;
    series: string | null;
    code: string | null;
    printedTotal: number | null;
    total: number | null;
    releaseDate: string | null;
    logoUrl: string | null;
    symbolUrl: string | null;
  };
  createdAt: string;
  updatedAt: string;
}

export interface LocalCardsPage {
  data: LocalCard[];
  pagination: Pagination;
}

export interface ProductInput {
  cardId: string;
  conditionId: string;
  languageId: string;
  categoryId: string;
  price: string;
  observation: string | null;
  active: boolean;
  featured: boolean;
  featuredOrder: number;
  availableQuantity: number;
}

export interface ProductDraft {
  cardId: string;
  conditionId: string;
  languageId: string;
  categoryId: string;
  price: string;
  observation: string;
  active: boolean;
  featured: boolean;
  featuredOrder: string;
  availableQuantity: string;
}

const maximumQuantity = 2_147_483_647;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Stock changes use their own endpoint, including the last observed quantity. */
export function validateStock(value: string): number | null {
  const text = value.trim();
  if (!/^\d+$/.test(text)) return null;
  const quantity = Number(text);
  return Number.isInteger(quantity) && quantity <= maximumQuantity
    ? quantity
    : null;
}

export function productDraft(product?: AdminProduct): ProductDraft {
  return {
    cardId: product?.card.id ?? "",
    conditionId: product?.condition.id ?? "",
    languageId: product?.language.id ?? "",
    categoryId: product?.category.id ?? "",
    price: product?.price ?? "",
    observation: product?.observation ?? "",
    active: product?.active ?? true,
    featured: product?.featured ?? false,
    featuredOrder: String(product?.featuredOrder ?? 0),
    availableQuantity: String(product?.inventory?.availableQuantity ?? 0),
  };
}

export function validateProduct(
  values: ProductDraft,
  creating: boolean,
): { input?: ProductInput; errors: Partial<Record<keyof ProductDraft, string>> } {
  const errors: Partial<Record<keyof ProductDraft, string>> = {};
  const references = {
    cardId: values.cardId.trim(),
    conditionId: values.conditionId.trim(),
    languageId: values.languageId.trim(),
    categoryId: values.categoryId.trim(),
  };
  for (const key of ["cardId", "conditionId", "languageId", "categoryId"] as const) {
    if (!uuid.test(references[key])) errors[key] = "Selecione uma opção válida.";
  }
  const price = values.price.trim().replace(",", ".");
  if (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(price) || !/[1-9]/.test(price)) {
    errors.price = "Informe um preço maior que zero, com até 10 dígitos inteiros e 2 casas decimais.";
  }
  if (values.observation.length > 2000) {
    errors.observation = "Use até 2.000 caracteres na observação.";
  }
  const featuredOrder = validateStock(values.featuredOrder);
  if (featuredOrder === null) {
    errors.featuredOrder = "Informe uma ordem inteira entre 0 e 2.147.483.647.";
  }
  const quantity = validateStock(values.availableQuantity);
  if (creating && quantity === null) {
    errors.availableQuantity = "Informe um estoque inteiro entre 0 e 2.147.483.647.";
  }
  if (typeof values.active !== "boolean") errors.active = "Informe se o produto está ativo.";
  if (typeof values.featured !== "boolean") errors.featured = "Informe se o produto é destaque.";
  if (Object.keys(errors).length > 0) return { errors };

  // Normalize decimal text without floating point arithmetic or rounding.
  const [whole, decimals = ""] = price.split(".");
  return {
    errors,
    input: {
      ...references,
      price: `${whole}.${decimals.padEnd(2, "0")}`,
      observation: values.observation.trim() || null,
      active: values.active,
      featured: values.featured,
      featuredOrder: featuredOrder!,
      availableQuantity: quantity ?? 0,
    },
  };
}

export function changedProductFields(
  before: AdminProduct,
  input: ProductInput,
): Partial<Omit<ProductInput, "availableQuantity">> {
  const changes: Partial<Omit<ProductInput, "availableQuantity">> = {};
  if (input.cardId !== before.card.id) changes.cardId = input.cardId;
  if (input.conditionId !== before.condition.id) changes.conditionId = input.conditionId;
  if (input.languageId !== before.language.id) changes.languageId = input.languageId;
  if (input.categoryId !== before.category.id) changes.categoryId = input.categoryId;
  if (input.price !== before.price) changes.price = input.price;
  if (input.observation !== before.observation) changes.observation = input.observation;
  if (input.active !== before.active) changes.active = input.active;
  if (input.featured !== before.featured) changes.featured = input.featured;
  if (input.featuredOrder !== before.featuredOrder) changes.featuredOrder = input.featuredOrder;
  return changes;
}
