import { authorized } from "./session";
import type { LocalCard, LocalCardsPage } from "./admin-products";

export interface ExternalCard {
  externalId: string;
  name: string;
  number: string;
  set: { externalId: string; name: string; printedTotal: number };
  rarity: string | null;
  artist: string | null;
  images: { small: string | null; large: string | null };
}
export interface CardSearchQuery {
  name?: string;
  code?: string;
}
export interface CardSearchDraft {
  name: string;
  code: string;
}
type CardSearchErrors = Partial<Record<"name" | "code" | "general", string>>;
type CardAction = "local" | "search" | "import";
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const controls = (value: string) =>
  Array.from(value).some(
    (character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
  );
const integer = (value: unknown, min = 0): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= min;
const text = (value: unknown): value is string =>
  typeof value === "string" && Boolean(value.trim());
const optionalText = (value: unknown): value is string | null =>
  value === null || typeof value === "string";
function invalid(): never {
  throw Object.assign(new Error("Resposta de cartas inválida."), {
    code: "INVALID_RESPONSE",
  });
}
function invalidInput(): never {
  throw Object.assign(new Error("Parâmetros de cartas inválidos."), {
    status: 400,
  });
}

export function validateCardSearch(draft: CardSearchDraft): {
  query?: CardSearchQuery;
  errors: CardSearchErrors;
} {
  const errors: CardSearchErrors = {};
  const name = typeof draft?.name === "string" ? draft.name.trim() : "";
  const code = typeof draft?.code === "string" ? draft.code.trim() : "";
  if (
    typeof draft?.name !== "string" ||
    draft.name.length > 200 ||
    controls(draft.name)
  )
    errors.name = "Informe um nome com até 200 caracteres válidos.";
  if (
    typeof draft?.code !== "string" ||
    draft.code.length > 33 ||
    controls(draft.code)
  )
    errors.code = "Use número/total, como 025/182, com até 33 caracteres.";
  else if (code) {
    const values = code.split("/").map(Number);
    if (
      !/^\d+\/\d+$/.test(code) ||
      values.length !== 2 ||
      !integer(values[0]) ||
      !integer(values[1], 1)
    )
      errors.code = "Use número/total, como 025/182, com total maior que zero.";
  }
  if (!name && !code)
    errors.general = "Informe o nome da carta ou o código, como 025/182.";
  if (Object.keys(errors).length) return { errors };
  return {
    errors,
    query: { ...(name ? { name } : {}), ...(code ? { code } : {}) },
  };
}

export function isImportableCard(externalId: string): boolean {
  if (typeof externalId !== "string" || externalId.length > 100) return false;
  const match = /^tcggo_([1-9]\d*)$/.exec(externalId);
  return Boolean(match && Number.isSafeInteger(Number(match[1])));
}
function image(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") invalid();
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? value
      : null;
  } catch {
    return null;
  }
}
function images(value: unknown) {
  if (!object(value)) invalid();
  return { small: image(value.small), large: image(value.large) };
}
function basic(value: unknown) {
  if (
    !object(value) ||
    !text(value.externalId) ||
    !text(value.name) ||
    !text(value.number) ||
    !optionalText(value.rarity) ||
    !optionalText(value.artist)
  )
    invalid();
  return {
    externalId: value.externalId,
    name: value.name,
    number: value.number,
    rarity: value.rarity,
    artist: value.artist,
    images: images(value.images),
  };
}
function external(value: unknown): ExternalCard {
  const card = basic(value);
  if (
    !object(value) ||
    !object(value.set) ||
    !text(value.set.externalId) ||
    !text(value.set.name) ||
    !integer(value.set.printedTotal, 1)
  )
    invalid();
  return {
    ...card,
    set: {
      externalId: value.set.externalId,
      name: value.set.name,
      printedTotal: value.set.printedTotal,
    },
  };
}
function timestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
function date(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}
function local(value: unknown): LocalCard {
  const card = basic(value);
  if (
    !object(value) ||
    typeof value.id !== "string" ||
    !uuid.test(value.id) ||
    !timestamp(value.createdAt) ||
    !timestamp(value.updatedAt) ||
    !object(value.set)
  )
    invalid();
  const set = value.set;
  if (
    typeof set.id !== "string" ||
    !uuid.test(set.id) ||
    !text(set.externalId) ||
    !text(set.name) ||
    !optionalText(set.series) ||
    !optionalText(set.code) ||
    !(set.printedTotal === null || integer(set.printedTotal)) ||
    !(set.total === null || integer(set.total)) ||
    !date(set.releaseDate)
  )
    invalid();
  return {
    ...card,
    id: value.id,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    set: {
      id: set.id,
      externalId: set.externalId,
      name: set.name,
      series: set.series,
      code: set.code,
      printedTotal: set.printedTotal,
      total: set.total,
      releaseDate: set.releaseDate,
      logoUrl: image(set.logoUrl),
      symbolUrl: image(set.symbolUrl),
    },
  };
}
async function request(
  path: string,
  controller: AbortController,
  externalId?: string,
): Promise<unknown> {
  if (controller.signal.aborted)
    throw Object.assign(new Error("Consulta interrompida."), {
      code: "ABORTED",
    });
  let timeout = false;
  let stop!: () => void;
  const interrupted = new Promise<never>((_, reject) => {
    stop = () =>
      reject(
        Object.assign(new Error("Consulta interrompida."), {
          code: timeout ? "TIMEOUT" : "ABORTED",
        }),
      );
    controller.signal.addEventListener("abort", stop, { once: true });
  });
  const timer = window.setTimeout(() => {
    timeout = true;
    controller.abort();
  }, 15000);
  try {
    return await Promise.race([
      authorized<unknown>(path, {
        method: externalId === undefined ? "GET" : "POST",
        signal: controller.signal,
        cache: "no-store",
        ...(externalId === undefined
          ? {}
          : { body: JSON.stringify({ externalId }) }),
      }),
      interrupted,
    ]);
  } catch (error) {
    const status =
      object(error) && integer(error.status, 100) && error.status <= 599
        ? error.status
        : undefined;
    const code =
      object(error) && ["ABORTED", "TIMEOUT"].includes(String(error.code))
        ? error.code
        : undefined;
    throw Object.assign(
      new Error("Não foi possível consultar ou importar a carta."),
      status === undefined ? {} : { status },
      code === undefined ? {} : { code },
    );
  } finally {
    window.clearTimeout(timer);
    controller.signal.removeEventListener("abort", stop);
  }
}
export async function fetchLocalCards(
  query: { page: number; name?: string },
  controller: AbortController,
): Promise<LocalCardsPage> {
  if (
    !object(query) ||
    !integer(query.page, 1) ||
    query.page > 10000 ||
    (query.name !== undefined &&
      (typeof query.name !== "string" ||
        query.name.length > 200 ||
        !query.name.trim() ||
        controls(query.name)))
  )
    invalidInput();
  const parameters = new URLSearchParams({
    page: String(query.page),
    limit: "12",
  });
  if (query.name) parameters.set("name", query.name.trim());
  const value = await request(`/cards?${parameters}`, controller);
  if (!object(value) || !Array.isArray(value.data) || !object(value.pagination))
    invalid();
  const page = value.pagination;
  if (
    page.page !== query.page ||
    page.limit !== 12 ||
    !integer(page.total) ||
    page.totalPages !== Math.ceil(page.total / 12) ||
    value.data.length !==
      Math.min(12, Math.max(0, page.total - (query.page - 1) * 12))
  )
    invalid();
  const data = value.data.map(local);
  if (
    new Set(data.map((row) => row.id.toLowerCase())).size !== data.length ||
    new Set(data.map((row) => row.externalId)).size !== data.length
  )
    invalid();
  return {
    data,
    pagination: {
      page: query.page,
      limit: 12,
      total: page.total,
      totalPages: page.totalPages as number,
    },
  };
}
export async function fetchLocalCard(
  id: string,
  controller: AbortController,
): Promise<LocalCard> {
  if (typeof id !== "string" || !uuid.test(id)) invalidInput();
  const result = local(await request(`/cards/${id}`, controller));
  if (result.id.toLowerCase() !== id.toLowerCase()) invalid();
  return result;
}
export async function searchExternalCards(
  query: CardSearchQuery,
  controller: AbortController,
): Promise<ExternalCard[]> {
  if (
    !object(query) ||
    (query.name !== undefined && typeof query.name !== "string") ||
    (query.code !== undefined && typeof query.code !== "string")
  )
    invalidInput();
  const validated = validateCardSearch({
    name: typeof query.name === "string" ? query.name : "",
    code: typeof query.code === "string" ? query.code : "",
  });
  if (!validated.query) invalidInput();
  const value = await request(
    `/cards/search?${new URLSearchParams(validated.query as Record<string, string>)}`,
    controller,
  );
  if (!Array.isArray(value)) invalid();
  const cards = value.map(external);
  if (new Set(cards.map((card) => card.externalId)).size !== cards.length)
    invalid();
  return cards;
}
export async function importExternalCard(
  externalId: string,
  controller: AbortController,
): Promise<LocalCard> {
  if (!isImportableCard(externalId)) invalidInput();
  const card = local(await request("/cards/import", controller, externalId));
  if (card.externalId !== externalId) invalid();
  return card;
}
export function cardError(error: unknown, action: CardAction): string {
  const status =
    object(error) && integer(error.status) ? error.status : undefined;
  const code = object(error) ? error.code : undefined;
  if (status === 401)
    return "Sua sessão expirou. Entre novamente para continuar.";
  if (status === 403)
    return "Acesso restrito a administradores. Entre com uma conta autorizada.";
  if (status === 400 || status === 422)
    return action === "search"
      ? "Pesquisa inválida ou muito ampla. Confira os campos e informe um nome mais específico ou combine nome e código."
      : "Confira a carta e os dados informados antes de tentar novamente.";
  if (status === 404)
    return "Carta não encontrada. Atualize os resultados antes de continuar.";
  if (status === 409)
    return "Já existe uma carta com esse número na coleção. Consulte a biblioteca antes de tentar importar novamente.";
  if (status === 429)
    return "O limite de consultas foi atingido. Aguarde antes de pesquisar ou importar novamente.";
  if (action === "import" && (status === 502 || status === 503))
    return "O serviço de importação está indisponível. Confira a configuração da API no servidor ou tente mais tarde. A importação pode ter sido concluída; consulte a biblioteca ou retome esta mesma carta. As cartas já cadastradas continuam disponíveis.";
  if (action === "import")
    return "Não foi possível confirmar a importação. Ela pode ter sido concluída. Consulte a biblioteca ou retome a importação desta mesma carta.";
  if (code === "TIMEOUT" || status === 408 || status === 504)
    return "A consulta demorou mais que o esperado. Tente novamente em instantes.";
  if (code === "INVALID_RESPONSE")
    return "Não foi possível ler os dados das cartas. Atualize a consulta para tentar novamente.";
  if (status === 502 || status === 503)
    return action === "search"
      ? "A pesquisa externa está indisponível. Confira a configuração da API no servidor ou tente novamente mais tarde. As cartas já cadastradas continuam disponíveis."
      : "A biblioteca de cartas está temporariamente indisponível. Tente novamente mais tarde.";
  return action === "search"
    ? "Não foi possível pesquisar as cartas. Tente novamente em instantes."
    : "Não foi possível carregar a biblioteca de cartas. Atualize a consulta para tentar novamente.";
}
