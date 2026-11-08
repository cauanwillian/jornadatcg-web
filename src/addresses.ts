import { authorized } from "./session";
import type { Address, AddressInput } from "./ShippingAddresses";

export const addressStates =
  "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(
    " ",
  );
export interface AddressDraft {
  label: string;
  recipientName: string;
  zipCode: string;
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
  isDefault: boolean;
}
export type AddressErrors = Partial<Record<keyof AddressDraft, string>>;
const textLimits = {
  label: 60,
  recipientName: 120,
  street: 200,
  number: 20,
  complement: 120,
  neighborhood: 120,
  city: 120,
} as const;
const names: Record<keyof typeof textLimits, string> = {
  label: "Identificação",
  recipientName: "Nome do destinatário",
  street: "Rua ou avenida",
  number: "Número",
  complement: "Complemento",
  neighborhood: "Bairro",
  city: "Cidade",
};
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const controls = (value: string) =>
  Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
const iso = (value: unknown): value is string => {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  )
    return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
};
export function emptyAddressDraft(): AddressDraft {
  return {
    label: "",
    recipientName: "",
    zipCode: "",
    street: "",
    number: "",
    complement: "",
    neighborhood: "",
    city: "",
    state: "",
    isDefault: false,
  };
}
export function formatAddressZip(zip: string): string {
  return /^\d{8}$/.test(zip) ? `${zip.slice(0, 5)}-${zip.slice(5)}` : zip;
}
export function addressToDraft(address: Address): AddressDraft {
  return {
    label: address.label ?? "",
    recipientName: address.recipientName,
    zipCode: formatAddressZip(address.zipCode),
    street: address.street,
    number: address.number,
    complement: address.complement ?? "",
    neighborhood: address.neighborhood,
    city: address.city,
    state: address.state,
    isDefault: address.isDefault,
  };
}
export function validateAddressDraft(draft: AddressDraft): {
  input?: AddressInput;
  errors: AddressErrors;
} {
  const errors: AddressErrors = {};
  const values: Record<string, string | null> = {};
  for (const [key, max] of Object.entries(textLimits) as [
    keyof typeof textLimits,
    number,
  ][]) {
    const raw = draft?.[key];
    const optional = key === "label" || key === "complement";
    if (
      typeof raw !== "string" ||
      controls(raw) ||
      raw.trim().length > max ||
      (!optional && !raw.trim())
    )
      errors[key] =
        `${names[key]} deve conter ${optional ? "até" : "entre 1 e"} ${max} caracteres válidos.`;
    else values[key] = raw.trim() || null;
  }
  const zip = draft?.zipCode;
  if (
    typeof zip !== "string" ||
    !/^\d{5}-?\d{3}$/.test(zip.trim()) ||
    controls(zip)
  )
    errors.zipCode = "Informe um CEP de 8 dígitos, com ou sem hífen.";
  const state =
    typeof draft?.state === "string" ? draft.state.trim().toUpperCase() : "";
  if (
    !addressStates.includes(state) ||
    (typeof draft?.state === "string" && controls(draft.state))
  )
    errors.state = "Selecione uma UF brasileira válida.";
  if (typeof draft?.isDefault !== "boolean")
    errors.isDefault = "Informe se este é o endereço principal.";
  if (Object.keys(errors).length) return { errors };
  return {
    errors,
    input: {
      label: values.label,
      recipientName: values.recipientName!,
      zipCode: zip.trim().replace("-", ""),
      street: values.street!,
      number: values.number!,
      complement: values.complement,
      neighborhood: values.neighborhood!,
      city: values.city!,
      state,
      isDefault: draft.isDefault,
    },
  };
}
export function addressBody(address: Address): AddressInput {
  return {
    label: address.label,
    recipientName: address.recipientName,
    zipCode: address.zipCode,
    street: address.street,
    number: address.number,
    complement: address.complement,
    neighborhood: address.neighborhood,
    city: address.city,
    state: address.state,
    isDefault: address.isDefault,
  };
}
function parseAddress(value: unknown, id?: string): Address {
  if (
    !object(value) ||
    typeof value.id !== "string" ||
    !uuid.test(value.id) ||
    (id !== undefined && value.id !== id) ||
    typeof value.isDefault !== "boolean" ||
    !iso(value.createdAt) ||
    !iso(value.updatedAt) ||
    !/^\d{8}$/.test(String(value.zipCode)) ||
    typeof value.zipCode !== "string" ||
    typeof value.state !== "string" ||
    !addressStates.includes(value.state)
  )
    throw new Error("Resposta de endereço inválida.");
  const fields: Record<string, string | null> = {};
  for (const [key, max] of Object.entries(textLimits)) {
    const raw = value[key];
    if ((key === "label" || key === "complement") && raw === null) {
      fields[key] = null;
      continue;
    }
    if (
      typeof raw !== "string" ||
      !raw.trim() ||
      raw !== raw.trim() ||
      raw.length > max ||
      controls(raw)
    )
      throw new Error("Resposta de endereço inválida.");
    fields[key] = raw;
  }
  return {
    id: value.id,
    label: fields.label,
    recipientName: fields.recipientName!,
    zipCode: value.zipCode,
    street: fields.street!,
    number: fields.number!,
    complement: fields.complement,
    neighborhood: fields.neighborhood!,
    city: fields.city!,
    state: value.state,
    isDefault: value.isDefault,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}
function checkedId(id: string): string {
  if (typeof id !== "string" || !uuid.test(id))
    throw new Error("Endereço inválido.");
  return encodeURIComponent(id);
}
function checkedBody(input: AddressInput): AddressInput {
  const validated = validateAddressDraft({
    ...input,
    label: input.label ?? "",
    complement: input.complement ?? "",
    isDefault: input.isDefault ?? false,
  });
  if (!validated.input) throw new Error("Dados de endereço inválidos.");
  if (input.isDefault === undefined) {
    const { isDefault: _omitted, ...body } = validated.input;
    return body;
  }
  return validated.input;
}
async function request(
  path: string,
  controller: AbortController,
  method: "GET" | "POST" | "PUT" | "DELETE",
  body?: AddressInput,
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
        method,
        signal: controller.signal,
        cache: "no-store",
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      interrupted,
    ]);
  } finally {
    window.clearTimeout(timer);
    controller.signal.removeEventListener("abort", stop);
  }
}
export async function fetchAddresses(
  controller: AbortController,
): Promise<Address[]> {
  const value = await request("/addresses", controller, "GET");
  if (!Array.isArray(value) || value.length > 20)
    throw new Error("Resposta de endereços inválida.");
  const rows = value.map((row) => parseAddress(row));
  if (
    new Set(rows.map((row) => row.id.toLowerCase())).size !== rows.length ||
    rows.filter((row) => row.isDefault).length > 1
  )
    throw new Error("Resposta de endereços inválida.");
  return rows;
}
export async function fetchAddress(
  id: string,
  controller: AbortController,
): Promise<Address> {
  return parseAddress(
    await request(`/addresses/${checkedId(id)}`, controller, "GET"),
    id,
  );
}
export async function createAddress(
  input: AddressInput,
  controller: AbortController,
): Promise<Address> {
  return parseAddress(
    await request("/addresses", controller, "POST", checkedBody(input)),
  );
}
export async function replaceAddress(
  id: string,
  input: AddressInput,
  controller: AbortController,
): Promise<Address> {
  return parseAddress(
    await request(
      `/addresses/${checkedId(id)}`,
      controller,
      "PUT",
      checkedBody(input),
    ),
    id,
  );
}
export async function deleteAddress(
  id: string,
  controller: AbortController,
): Promise<void> {
  const result = await request(
    `/addresses/${checkedId(id)}`,
    controller,
    "DELETE",
  );
  if (result !== undefined) throw new Error("Resposta de remoção inválida.");
}
