import { describe, expect, it } from "vitest";
import {
  labelActions, labelStatusText, safeLabelPrintUrl, shipmentStatusText,
  validateCreateLabel, validateExpectedCost, validateRecoveryId,
  type AdminShipmentDetail, type CreateLabelDraft, type ShippingLabelDto,
} from "./admin-shipments";

const id = "11111111-1111-4111-8111-111111111111";
const now = "2026-10-23T12:00:00.000Z";

function label(changes: Partial<ShippingLabelDto> = {}): ShippingLabelDto {
  return {
    id: "22222222-2222-4222-8222-222222222222", shipmentId: id,
    provider: "melhorenvio:sandbox", remoteId: "33333333-3333-4333-8333-333333333333",
    status: "PENDING", cost: "12.68", generatedAt: null, createStartedAt: now,
    checkoutStartedAt: null, generateStartedAt: null, ...changes,
  };
}

function shipment(changes: Partial<AdminShipmentDetail> = {}): AdminShipmentDetail {
  return {
    id, userId: "44444444-4444-4444-8444-444444444444", status: "PREPARING",
    packedAt: now, shippingPaidAt: now, trackingCode: null, createdAt: now,
    updatedAt: now, shippedAt: null, deliveredAt: null,
    provider: "melhorenvio:sandbox", shippingCost: "12.68", label: null,
    address: {
      addressId: "55555555-5555-4555-8555-555555555555", recipientName: "Demonstração",
      zipCode: "01001000", street: "Rua de demonstração", number: "100", complement: null,
      neighborhood: "Centro", city: "São Paulo", state: "SP",
    },
    quote: {
      provider: "melhorenvio:sandbox", carrier: "Correios", serviceName: "SEDEX",
      serviceCode: "2", amount: "12.68",
      package: {
        name: "Pequena", height: 3, width: 12, length: 17, weight: 0.15,
        originZipCode: "78556858", destinationZipCode: "01001000", declaredValue: "10.00",
      },
    },
    items: [{ quantity: 1, orderItem: {
      cardName: "Pikachu", cardNumber: "025", setName: "Coleção", conditionName: "Near mint",
      languageName: "Português", unitPrice: "10.00",
    } }],
    ...changes,
  };
}

describe("administrative shipment action guards", () => {
  it("distinguishes unconsulted label state from a confirmed absence", () => {
    expect(labelActions(shipment(), undefined)).toMatchObject({
      create: false, checkout: false, generate: false, recover: false, print: false, sync: true,
    });
    expect(labelActions(shipment(), null)).toMatchObject({ create: true, sync: false });
  });
  it("allows packing before creating a label, only in preparation after payment", () => {
    const row = shipment({ packedAt: null });
    expect(labelActions(row, null)).toMatchObject({ pack: true, create: false });
    expect(labelActions(shipment(), null).pack).toBe(false);
    expect(labelActions(shipment({ shippingPaidAt: null, packedAt: null }), null).pack).toBe(false);
  });
  it.each(["PENDING", "READY_TO_SHIP", "SHIPPED", "DELIVERED", "CANCELLED", "ACCUMULATING"] as const)(
    "does not allow preparation writes for %s", (status) => {
      const actions = labelActions(shipment({ status }), label());
      expect(actions).toMatchObject({ pack: false, create: false, checkout: false, generate: false, recover: false });
    },
  );
  it("does not offer any purchase or creation when payment or contents are missing", () => {
    for (const row of [shipment({ shippingPaidAt: null }), shipment({ items: [] })]) {
      expect(labelActions(row, null).create).toBe(false);
      expect(labelActions(row, label()).checkout).toBe(false);
      expect(labelActions(row, label({ status: "PURCHASED" })).generate).toBe(false);
    }
  });
  it("requires the paid quote, provider, supported service and historical recipient before creation", () => {
    for (const row of [
      shipment({ provider: null }), shipment({ provider: "superfrete:sandbox" }),
      shipment({ quote: null }), shipment({ address: null }), shipment({ shippingCost: null }),
      shipment({ quote: { ...shipment().quote!, provider: "melhorenvio:production" } }),
      shipment({ quote: { ...shipment().quote!, serviceCode: "999" } }),
      shipment({ quote: { ...shipment().quote!, amount: "12.69" } }),
      shipment({ quote: { ...shipment().quote!, package: null } }),
    ]) expect(labelActions(row, null).create).toBe(false);
  });
  it.each(["1", "2", "3", "4", "17"])("supports label creation for service %s", (serviceCode) => {
    expect(labelActions(shipment({ quote: { ...shipment().quote!, serviceCode } }), null).create).toBe(true);
  });
  it("permits corrected creation after an explicit rejection but not an ambiguous request", () => {
    expect(labelActions(shipment(), label({ status: "INTENT", remoteId: null, createStartedAt: null })).create).toBe(true);
    const uncertain = label({ status: "CREATING", remoteId: null });
    expect(labelActions(shipment(), uncertain)).toMatchObject({ create: false, recover: true, sync: true });
    expect(labelActions(shipment(), { ...uncertain, createStartedAt: null }).recover).toBe(false);
  });
  it("does not recover over an already bound label", () => {
    expect(labelActions(shipment(), label({ status: "CREATING" })).recover).toBe(false);
  });
  it("requires a pending label with cost covered by the paid freight for checkout", () => {
    expect(labelActions(shipment(), label()).checkout).toBe(true);
    expect(labelActions(shipment(), label({ cost: "0.01" })).checkout).toBe(true);
    for (const cost of [null, "12.69", "0.00", "12.680", "NaN"]) {
      expect(labelActions(shipment(), label({ cost })).checkout).toBe(false);
    }
  });
  it("compares large costs in exact cents without rounding", () => {
    const row = shipment({ shippingCost: "9999999999.98" });
    expect(labelActions(row, label({ cost: "9999999999.98" })).checkout).toBe(true);
    expect(labelActions(row, label({ cost: "9999999999.99" })).checkout).toBe(false);
  });
  it("keeps checkout locked after an uncertain purchase even when sync returns PENDING", () => {
    expect(labelActions(shipment(), label({ checkoutStartedAt: now })).checkout).toBe(false);
    expect(labelActions(shipment(), label({ status: "PURCHASING", checkoutStartedAt: now })).checkout).toBe(false);
  });
  it("generates only once after purchase and retains the uncertain generation guard", () => {
    expect(labelActions(shipment(), label({ status: "PURCHASED" })).generate).toBe(true);
    expect(labelActions(shipment(), label()).generate).toBe(false);
    expect(labelActions(shipment(), label({ status: "PURCHASED", generateStartedAt: now })).generate).toBe(false);
    expect(labelActions(shipment(), label({ status: "GENERATING", generateStartedAt: now })).generate).toBe(false);
  });
  it("does not print before generation and permits later printing after posting or delivery", () => {
    expect(labelActions(shipment(), label({ status: "PURCHASED" })).print).toBe(false);
    for (const status of ["READY_TO_SHIP", "SHIPPED", "DELIVERED"] as const) {
      expect(labelActions(shipment({ status }), label({ status: "GENERATED", generatedAt: now })).print).toBe(true);
    }
  });
  it.each(["REVIEW_REQUIRED", "CANCELED", "EXPIRED", "SUSPENDED", "NEW_UNKNOWN_STATUS", "__proto__"])(
    "disables label writes and printing in %s", (status) => {
      expect(labelActions(shipment(), label({ status, generatedAt: now }))).toMatchObject({
        create: false, checkout: false, generate: false, recover: false, print: false,
      });
    },
  );
  it("blocks labels for a different shipment or provider environment", () => {
    for (const item of [label({ shipmentId: "another" }), label({ provider: "melhorenvio:production" })]) {
      expect(labelActions(shipment(), item)).toMatchObject({
        create: false, checkout: false, generate: false, recover: false, print: false,
      });
    }
    expect(labelActions(shipment(), label({ shipmentId: "another" })).sync).toBe(false);
  });
});

const draft = (changes: Partial<CreateLabelDraft> = {}): CreateLabelDraft => ({
  recipientDocument: "529.982.247-25", recipientPhone: "(11) 99999-9999", invoiceKey: "", ...changes,
});

describe("recipient and invoice data", () => {
  it("validates CPF check digits and normalizes ordinary formatting for the backend", () => {
    expect(validateCreateLabel(draft())).toEqual({ errors: {}, input: {
      recipientDocument: "52998224725", recipientPhone: "11999999999",
    } });
    expect(validateCreateLabel(draft({ recipientPhone: "1133334444" })).input?.recipientPhone).toBe("1133334444");
  });
  it.each(["", "11111111111", "00000000000", "52998224724", "5299822472", "529982247251", "x52998224725", "52998224725!", "52998224725\nCPF"])(
    "rejects invalid CPF %s", (recipientDocument) => {
      const result = validateCreateLabel(draft({ recipientDocument }));
      expect(result.input).toBeUndefined();
      expect(result.errors.recipientDocument).toBeTruthy();
    },
  );
  it.each(["", "119999999", "+5511999999999", "119999999999", "abc11999999999", "11999999999!", "１1999999999"])(
    "rejects invalid telephone %s without dropping arbitrary characters", (recipientPhone) => {
      expect(validateCreateLabel(draft({ recipientPhone })).errors.recipientPhone).toBeTruthy();
    },
  );
  it("omits an empty optional invoice and preserves all 44 digits exactly", () => {
    expect(validateCreateLabel(draft({ invoiceKey: "  " })).input).not.toHaveProperty("invoiceKey");
    const invoiceKey = "0".repeat(43) + "1";
    expect(validateCreateLabel(draft({ invoiceKey })).input?.invoiceKey).toBe(invoiceKey);
  });
  it.each(["1".repeat(43), "1".repeat(45), "a" + "1".repeat(43), "1".repeat(22) + " " + "1".repeat(22)])(
    "rejects an invalid invoice key", (invoiceKey) => {
      expect(validateCreateLabel(draft({ invoiceKey })).errors.invoiceKey).toBeTruthy();
    },
  );
});

describe("exact approved purchase cost", () => {
  it.each(["0.01", "12.68", "9999999999.99"])("accepts %s without conversion", (value) => {
    expect(validateExpectedCost(value)).toBe(true);
  });
  it.each(["0.00", "12.6", "12", "12,68", "012.68", " 12.68", "12.68 ", "-12.68", "1e2", "10000000000.00", 12.68, null])(
    "rejects a noncanonical cost %s", (value) => expect(validateExpectedCost(value)).toBe(false),
  );
});

describe("recovery and private print URL safety", () => {
  it("normalizes a valid external UUID without accepting a pasted URL or order number", () => {
    expect(validateRecoveryId(" ABCDEFAB-1111-4111-8111-111111111111 ")).toBe("abcdefab-1111-4111-8111-111111111111");
    for (const value of ["", "01", "ID_DA_ETIQUETA", `https://melhorenvio.com.br/${id}`, `${id}/checkout`, "11111111-1111-0111-8111-111111111111"])
      expect(validateRecoveryId(value)).toBeNull();
  });
  it("allows only the exact HTTPS host for the corresponding environment", () => {
    expect(safeLabelPrintUrl("https://sandbox.melhorenvio.com.br/imprimir/fixture?token=test", "melhorenvio:sandbox"))
      .toBe("https://sandbox.melhorenvio.com.br/imprimir/fixture?token=test");
    expect(safeLabelPrintUrl("https://melhorenvio.com.br/imprimir/fixture", "melhorenvio:production"))
      .toBe("https://melhorenvio.com.br/imprimir/fixture");
    expect(safeLabelPrintUrl("https://melhorenvio.com.br/imprimir/fixture", "melhorenvio:sandbox")).toBeNull();
    expect(safeLabelPrintUrl("https://sandbox.melhorenvio.com.br/imprimir/fixture", "melhorenvio:production")).toBeNull();
  });
  it.each([
    "javascript:alert(1)", "http://sandbox.melhorenvio.com.br/x", "//sandbox.melhorenvio.com.br/x",
    "https://evil.invalid/x", "https://sandbox.melhorenvio.com.br.evil.invalid/x",
    "https://user@sandbox.melhorenvio.com.br/x", "https://sandbox.melhorenvio.com.br:444/x",
    "https://sandbox.melhorenvio.com.br\\@evil.invalid/x", " https://sandbox.melhorenvio.com.br/x",
    "https://sandbox.melhorenvio.com.br/x\n", null,
  ])("rejects unsafe URL %s", (value) => expect(safeLabelPrintUrl(value, "melhorenvio:sandbox")).toBeNull());
  it("rejects an unrecognized provider and uses safe text for unknown statuses", () => {
    expect(safeLabelPrintUrl("https://melhorenvio.com.br/x", "other:production")).toBeNull();
    expect(labelStatusText("GENERATED")).toBe("Etiqueta gerada");
    expect(shipmentStatusText("SHIPPED")).toBe("Postado");
    expect(labelStatusText("__proto__")).toBe("Estado da etiqueta desconhecido");
    expect(shipmentStatusText("UNKNOWN")).toBe("Estado do envio desconhecido");
  });
});
