import type { Shipment } from "./shipping";

/** The admin queue intentionally does not expose recipient data or payment details. */
export interface AdminShipment {
  id: string;
  userId: string;
  status: Shipment["status"];
  packedAt: string | null;
  shippingPaidAt: string | null;
  trackingCode: string | null;
  createdAt: string;
  items: Array<{
    quantity: number;
    orderItem: {
      cardName: string;
      cardNumber: string;
      setName: string;
      conditionName: string;
      languageName: string;
    };
  }>;
}

export interface AdminShipmentsPage {
  items: AdminShipment[];
  page: number;
  pageSize: number;
  total: number;
}

export interface AdminShipmentDetail extends AdminShipment {
  provider: string | null;
  shippingCost: string | null;
  address: Shipment["address"] | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  updatedAt: string;
  quote: {
    provider: string;
    carrier: string;
    serviceName: string;
    serviceCode: string;
    amount: string;
    package: NonNullable<Shipment["quote"]>["package"] | null;
  } | null;
  label: ShippingLabelDto | null;
  items: Array<{
    quantity: number;
    orderItem: AdminShipment["items"][number]["orderItem"] & { unitPrice: string };
  }>;
}

export interface ShippingLabelDto {
  id: string;
  shipmentId: string;
  provider: string;
  remoteId: string | null;
  // Status is a string in the backend. Unrecognized values must not enable writes.
  status: string;
  cost: string | null;
  generatedAt: string | null;
  createStartedAt: string | null;
  checkoutStartedAt: string | null;
  generateStartedAt: string | null;
}

export interface LabelPrintResult {
  url: string;
  mode: "private";
}

export interface PackShipmentResult {
  id: string;
  status: Shipment["status"];
  packed: true;
}

export interface CreateLabelDraft {
  recipientDocument: string;
  recipientPhone: string;
  invoiceKey: string;
}

export interface CreateLabelInput {
  recipientDocument: string;
  recipientPhone: string;
  invoiceKey?: string;
}

const shipmentStatuses: Record<Shipment["status"], string> = {
  ACCUMULATING: "Compras acumuladas",
  PENDING: "Aguardando pagamento do frete",
  PREPARING: "Em preparação",
  READY_TO_SHIP: "Pronto para postagem",
  SHIPPED: "Postado",
  DELIVERED: "Entregue",
  CANCELLED: "Cancelado",
};

const labelStatuses: Record<string, string> = {
  INTENT: "Etiqueta ainda não criada",
  CREATING: "Criação enviada · consultar resultado",
  PENDING: "Aguardando compra da etiqueta",
  PURCHASING: "Compra enviada · consultar resultado",
  PURCHASED: "Etiqueta comprada",
  GENERATING: "Geração enviada · consultar resultado",
  GENERATED: "Etiqueta gerada",
  POSTED: "Postado",
  DELIVERED: "Entregue",
  REVIEW_REQUIRED: "Revisão necessária no Melhor Envio",
  CANCELED: "Etiqueta cancelada",
  EXPIRED: "Etiqueta vencida",
  SUSPENDED: "Etiqueta suspensa",
};

export function shipmentStatusText(status: string): string {
  return Object.hasOwn(shipmentStatuses, status)
    ? shipmentStatuses[status as Shipment["status"]]
    : "Estado do envio desconhecido";
}

export function labelStatusText(status: string): string {
  return Object.hasOwn(labelStatuses, status)
    ? labelStatuses[status]
    : "Estado da etiqueta desconhecido";
}

export function validateExpectedCost(value: unknown): value is string {
  return typeof value === "string" &&
    /^(0|[1-9]\d{0,9})\.\d{2}$/.test(value) && value !== "0.00";
}

/**
 * These are display guards, not authorization. The API rechecks payments,
 * refunds, provider environment, paid freight and every operation claim.
 * undefined means the label has not been consulted; null means confirmed absence.
 */
export function labelActions(
  shipment: AdminShipmentDetail,
  label: ShippingLabelDto | null | undefined,
) {
  const paid = Boolean(shipment.shippingPaidAt) && shipment.items.length > 0;
  const preparing = shipment.status === "PREPARING" && paid;
  const packed = preparing && Boolean(shipment.packedAt);
  const matches = label?.shipmentId === shipment.id;
  const supported = (label?.provider === "melhorenvio:sandbox" ||
    label?.provider === "melhorenvio:production") && label?.provider === shipment.provider;
  const known = Boolean(label && Object.hasOwn(labelStatuses, label.status));
  const valid = Boolean(matches && supported && known);
  const remote = valid && Boolean(label?.remoteId);
  const blocked = label && ["REVIEW_REQUIRED", "CANCELED", "EXPIRED", "SUSPENDED"].includes(label.status);
  const canCreate = (shipment.provider === "melhorenvio:sandbox" ||
    shipment.provider === "melhorenvio:production") &&
    shipment.quote?.provider === shipment.provider &&
    ["1", "2", "3", "4", "17"].includes(shipment.quote.serviceCode) &&
    validateExpectedCost(shipment.shippingCost) &&
    shipment.quote.amount === shipment.shippingCost && Boolean(shipment.quote.package) &&
    Boolean(shipment.address);
  const costCovered = validateExpectedCost(label?.cost) &&
    validateExpectedCost(shipment.shippingCost) &&
    BigInt(label.cost.replace(".", "")) <= BigInt(shipment.shippingCost.replace(".", ""));
  return {
    pack: preparing && !shipment.packedAt,
    create: packed && canCreate && (label === null || (valid && label?.status === "INTENT" &&
      !label.remoteId && !label.createStartedAt)),
    recover: Boolean(packed && valid && !label?.remoteId && label?.createStartedAt &&
      label.status === "CREATING"),
    checkout: Boolean(packed && remote && label?.status === "PENDING" &&
      !label.checkoutStartedAt && !label.generatedAt && costCovered),
    generate: Boolean(packed && remote && label?.status === "PURCHASED" &&
      !label.generateStartedAt && !label.generatedAt),
    sync: label !== null && (label === undefined || matches),
    print: Boolean(paid && remote && label?.generatedAt && !blocked),
  };
}

function formattedDigits(value: string, punctuation: RegExp, maxLength: number) {
  const text = value.trim();
  if (text.length > maxLength || !punctuation.test(text)) return null;
  return text.replace(/\D/g, "");
}

function validCpf(value: string): boolean {
  if (!/^\d{11}$/.test(value) || /^(\d)\1{10}$/.test(value)) return false;
  for (const length of [9, 10]) {
    let sum = 0;
    for (let index = 0; index < length; index++)
      sum += Number(value[index]) * (length + 1 - index);
    const remainder = (sum * 10) % 11;
    if (Number(value[length]) !== (remainder === 10 ? 0 : remainder)) return false;
  }
  return true;
}

export function validateCreateLabel(draft: CreateLabelDraft): {
  input?: CreateLabelInput;
  errors: Partial<Record<keyof CreateLabelDraft, string>>;
} {
  const errors: Partial<Record<keyof CreateLabelDraft, string>> = {};
  // Only ordinary formatting is removed. Letters and arbitrary symbols are rejected.
  const document = formattedDigits(draft.recipientDocument, /^[\d. -]+$/, 24);
  const phone = formattedDigits(draft.recipientPhone, /^[\d() -]+$/, 24);
  const invoice = draft.invoiceKey.trim();
  if (!document || !validCpf(document))
    errors.recipientDocument = "Informe um CPF válido do destinatário.";
  if (!phone || !/^\d{10,11}$/.test(phone))
    errors.recipientPhone = "Informe um telefone com DDD e 10 ou 11 dígitos.";
  if (invoice && !/^\d{44}$/.test(invoice))
    errors.invoiceKey = "A chave da nota fiscal deve conter 44 dígitos.";
  if (Object.keys(errors).length) return { errors };
  return {
    errors,
    input: {
      recipientDocument: document!,
      recipientPhone: phone!,
      ...(invoice ? { invoiceKey: invoice } : {}),
    },
  };
}

export function validateRecoveryId(value: string): string | null {
  const id = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
    ? id.toLowerCase() : null;
}

/** Mirrors the provider URL check and never accepts another environment or host. */
export function safeLabelPrintUrl(value: unknown, provider: string): string | null {
  const host = provider === "melhorenvio:sandbox" ? "sandbox.melhorenvio.com.br"
    : provider === "melhorenvio:production" ? "melhorenvio.com.br" : null;
  if (typeof value !== "string" || !host || /[\s\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== host || url.username ||
      url.password || url.port) return null;
    return url.href;
  } catch {
    return null;
  }
}
