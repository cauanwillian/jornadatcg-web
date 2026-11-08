import { authorized } from "./session";
import type { ProductOptions } from "./admin-products";

export type ReferenceKind = "category" | "condition" | "language";
export interface ReferenceInput {
  name: string;
  slug?: string;
  code?: string;
  description?: string | null;
}
export interface ReferenceDraft {
  name: string;
  identifier: string;
  description: string;
}
export interface ReferenceRecord extends ReferenceInput {
  id: string;
}
export type ReferenceOptions = ProductOptions;
export type ReferenceErrors = Partial<Record<keyof ReferenceDraft, string>>;
export const referenceCollections = {
  category: "categories",
  condition: "conditions",
  language: "languages",
} as const;
const labels = {
  category: {
    singular: "categoria",
    plural: "Categorias",
    heading: "Nova categoria",
    save: "Salvar categoria",
    identifier: "Identificador da categoria",
    example: "singles",
  },
  condition: {
    singular: "condição",
    plural: "Condições",
    heading: "Nova condição",
    save: "Salvar condição",
    identifier: "Código da condição",
    example: "NM",
  },
  language: {
    singular: "idioma",
    plural: "Idiomas",
    heading: "Novo idioma",
    save: "Salvar idioma",
    identifier: "Código do idioma",
    example: "PT-BR",
  },
} as const;
export function referenceLabels(kind: ReferenceKind) {
  return labels[kind];
}
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const code = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
const controls = (value: string) =>
  Array.from(value).some((character) => {
    const point = character.charCodeAt(0);
    return point < 32 || point === 127;
  });
const descriptionControls = (value: string) =>
  Array.from(value).some((character) => {
    const point = character.charCodeAt(0);
    return (point < 32 && ![9, 10, 13].includes(point)) || point === 127;
  });
const knownKind = (value: unknown): value is ReferenceKind =>
  typeof value === "string" && Object.hasOwn(referenceCollections, value);

export function validateReference(
  kind: ReferenceKind,
  draft: ReferenceDraft,
): {
  input?: ReferenceInput;
  errors: ReferenceErrors;
} {
  const errors: ReferenceErrors = {};
  if (!knownKind(kind))
    return { errors: { name: "Tipo de cadastro inválido." } };
  if (
    typeof draft?.name !== "string" ||
    !draft.name.trim() ||
    draft.name.length > 120 ||
    controls(draft.name)
  )
    errors.name = "Informe um nome com até 120 caracteres válidos.";
  const category = kind === "category";
  const max = category ? 100 : 20;
  const raw = draft?.identifier;
  const identifier =
    typeof raw === "string"
      ? category
        ? raw.trim().toLowerCase()
        : raw.trim().toUpperCase()
      : "";
  if (
    typeof raw !== "string" ||
    raw.length > max ||
    controls(raw) ||
    !(category ? slug : code).test(identifier)
  )
    errors.identifier = category
      ? "Use até 100 caracteres: letras, números e hífens entre palavras, como singles."
      : "Use até 20 caracteres: letras, números e hífens entre palavras, como NM ou PT-BR.";
  if (
    kind !== "language" &&
    (typeof draft?.description !== "string" ||
      draft.description.length > 2000 ||
      descriptionControls(draft.description))
  )
    errors.description = "Use uma descrição com até 2000 caracteres válidos.";
  if (Object.keys(errors).length) return { errors };
  return {
    errors,
    input: {
      name: draft.name.trim(),
      ...(category ? { slug: identifier } : { code: identifier }),
      ...(kind === "language"
        ? {}
        : { description: draft.description.trim() || null }),
    },
  };
}

function parseReference(kind: ReferenceKind, value: unknown): ReferenceRecord {
  if (
    !object(value) ||
    typeof value.id !== "string" ||
    !uuid.test(value.id) ||
    typeof value.name !== "string" ||
    !value.name.trim() ||
    value.name.length > 120
  )
    throw new Error("Resposta de cadastro inválida.");
  const base = { id: value.id, name: value.name };
  if (kind === "category") {
    if (
      typeof value.slug !== "string" ||
      value.slug.length > 100 ||
      !slug.test(value.slug)
    )
      throw new Error("Resposta de cadastro inválida.");
  } else if (
    typeof value.code !== "string" ||
    value.code.length > 20 ||
    !code.test(value.code)
  )
    throw new Error("Resposta de cadastro inválida.");
  // Existing descriptions may have line breaks; display their text without HTML.
  if (
    kind !== "language" &&
    value.description !== null &&
    (typeof value.description !== "string" || value.description.length > 2000)
  )
    throw new Error("Resposta de cadastro inválida.");
  return {
    ...base,
    ...(kind === "category"
      ? { slug: value.slug as string }
      : { code: value.code as string }),
    ...(kind === "language"
      ? {}
      : { description: value.description as string | null }),
  };
}

async function request(
  path: string,
  controller: AbortController,
  body?: ReferenceInput,
) {
  if (controller.signal.aborted) throw new Error("Consulta interrompida.");
  let stop!: () => void;
  const interrupted = new Promise<never>((_, reject) => {
    stop = () => reject(new Error("Solicitação interrompida."));
    controller.signal.addEventListener("abort", stop, { once: true });
  });
  const timer = window.setTimeout(() => controller.abort(), 15000);
  try {
    return await Promise.race([
      authorized<unknown>(path, {
        method: body ? "POST" : "GET",
        signal: controller.signal,
        cache: "no-store",
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      interrupted,
    ]);
  } catch (failure) {
    const status =
      object(failure) &&
      typeof failure.status === "number" &&
      Number.isInteger(failure.status)
        ? failure.status
        : undefined;
    throw Object.assign(
      new Error("Não foi possível consultar ou confirmar este cadastro."),
      status === undefined ? {} : { status },
    );
  } finally {
    window.clearTimeout(timer);
    controller.signal.removeEventListener("abort", stop);
  }
}

export async function fetchReferenceOptions(
  controller: AbortController,
): Promise<ProductOptions> {
  const value = await request("/products/options", controller);
  if (
    !object(value) ||
    !Array.isArray(value.categories) ||
    !Array.isArray(value.conditions) ||
    !Array.isArray(value.languages)
  )
    throw new Error("Resposta de cadastros inválida.");
  const rows = (kind: ReferenceKind, values: unknown[]) => {
    const parsed = values.map((entry) => parseReference(kind, entry));
    const identifiers = parsed.map(
      (entry) => (kind === "category" ? entry.slug : entry.code)!,
    );
    if (
      new Set(parsed.map((entry) => entry.id.toLowerCase())).size !==
        parsed.length ||
      new Set(identifiers).size !== parsed.length
    )
      throw new Error("Resposta de cadastros inválida.");
    return parsed;
  };
  return {
    categories: rows("category", value.categories).map((entry) => ({
      id: entry.id,
      name: entry.name,
      slug: entry.slug!,
      description: entry.description ?? null,
    })),
    conditions: rows("condition", value.conditions).map((entry) => ({
      id: entry.id,
      name: entry.name,
      code: entry.code!,
      description: entry.description ?? null,
    })),
    languages: rows("language", value.languages).map((entry) => ({
      id: entry.id,
      name: entry.name,
      code: entry.code!,
    })),
  };
}

export async function createReference(
  kind: ReferenceKind,
  input: ReferenceInput,
  controller: AbortController,
): Promise<ReferenceRecord> {
  if (!knownKind(kind) || !object(input))
    throw new Error("Dados de cadastro inválidos.");
  const checked = validateReference(kind, {
    name: input.name,
    identifier: (kind === "category" ? input.slug : input.code) ?? "",
    description: input.description ?? "",
  });
  if (!checked.input) throw new Error("Dados de cadastro inválidos.");
  const body = checked.input;
  const result = parseReference(
    kind,
    await request(`/products/${referenceCollections[kind]}`, controller, body),
  );
  if (
    result.name !== body.name ||
    (kind === "category"
      ? result.slug !== body.slug
      : result.code !== body.code)
  )
    throw new Error("Resposta de cadastro inválida.");
  return result;
}
