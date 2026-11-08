import { useEffect, useRef, useState } from "react";
import { money } from "./api";
import {
  CreateLabelForm,
  RecoveryLabelForm,
  LabelCheckoutForm,
} from "./AdminLabelForms";
import {
  labelActions,
  labelStatusText,
  shipmentStatusText,
  validateExpectedCost,
} from "./admin-shipments";
import type { AdminShipmentDetail as Detail } from "./admin-shipments";
import type {
  ShipmentOperation,
  ShipmentOperationInput,
} from "./useAdminShipments";

const date = (value: string | null) =>
  value ? new Date(value).toLocaleString("pt-BR") : "Aguardando";
export function AdminShipmentDetail({
  detail,
  busy,
  blocked,
  checking,
  printUrl,
  run,
  isCurrentSession,
}: {
  detail: Detail;
  busy: boolean;
  blocked: boolean;
  checking: boolean;
  printUrl: string | null;
  run: (
    operation: ShipmentOperation,
    input?: ShipmentOperationInput,
  ) => Promise<void>;
  isCurrentSession: () => boolean;
}) {
  const [review, setReview] = useState<"pack" | "generate" | null>(null);
  const [packed, setPacked] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const label = detail.label;
  const actions = labelActions(detail, label);
  const address = detail.address;
  const parcel = detail.quote?.package;
  const available = !blocked && !checking;
  const labelCost = validateExpectedCost(label?.cost)
    ? money(label.cost)
    : "Não informado";
  const production = detail.provider === "melhorenvio:production";
  return (
    <>
      <div className="shipment-detail-heading">
        <h3 ref={heading} tabIndex={-1}>
          Envio {detail.id.slice(0, 8)}
        </h3>
        <span className="order-status">
          {shipmentStatusText(detail.status)}
        </span>
        <p className="shipment-identifier">ID: {detail.id}</p>
      </div>
      {blocked && !checking && (
        <p className="shipping-note">
          Atualize o envio para conferir o resultado da última operação antes de
          continuar.
        </p>
      )}
      <div className="shipment-detail-grid">
        <section aria-label="Cartas deste envio">
          <h4>Cartas para separar</h4>
          <ul className="shipment-item-list">
            {detail.items.map((item, index) => (
              <li key={index}>
                <strong>
                  {item.quantity} × {item.orderItem.cardName}
                </strong>
                <small>
                  {item.orderItem.setName} · {item.orderItem.cardNumber}
                </small>
                <small>
                  {item.orderItem.conditionName} · {item.orderItem.languageName}
                </small>
              </li>
            ))}
          </ul>
        </section>
        <section aria-label="Destino e embalagem">
          <h4>Destino e embalagem</h4>
          {address ? (
            <address className="address-preview">
              <strong>{address.recipientName}</strong>
              <br />
              {address.street}, {address.number}
              {address.complement ? ` · ${address.complement}` : ""}
              <br />
              {address.neighborhood} · {address.city}/{address.state}
              <br />
              CEP {address.zipCode}
            </address>
          ) : (
            <p>
              Endereço indisponível. Revise o cadastro antes de emitir a
              etiqueta.
            </p>
          )}
          {parcel ? (
            <p className="shipment-package">
              {parcel.name} · {parcel.height} × {parcel.width} × {parcel.length}{" "}
              cm · {Math.round(parcel.weight * 1000)} g
            </p>
          ) : (
            <p className="muted">Embalagem da cotação indisponível.</p>
          )}
          {detail.quote && (
            <p className="muted">
              {detail.quote.carrier} · {detail.quote.serviceName}
            </p>
          )}
        </section>
      </div>
      <dl className="shipment-dates">
        <div>
          <dt>Frete pago</dt>
          <dd>{date(detail.shippingPaidAt)}</dd>
        </div>
        <div>
          <dt>Embalagem conferida</dt>
          <dd>{date(detail.packedAt)}</dd>
        </div>
        <div>
          <dt>Postagem</dt>
          <dd>{date(detail.shippedAt)}</dd>
        </div>
        <div>
          <dt>Entrega</dt>
          <dd>{date(detail.deliveredAt)}</dd>
        </div>
      </dl>
      {detail.trackingCode && (
        <p className="tracking-code">
          Rastreio: <strong>{detail.trackingCode}</strong>
        </p>
      )}
      <section className="shipment-label" aria-label="Etiqueta de transporte">
        <h4>Etiqueta de transporte</h4>
        <div className="shipment-costs">
          <p>
            Frete pago pelo cliente
            <strong>
              {validateExpectedCost(detail.shippingCost)
                ? money(detail.shippingCost)
                : "Não informado"}
            </strong>
          </p>
          <p>
            Custo da etiqueta no provedor<strong>{labelCost}</strong>
          </p>
        </div>
        <p>
          <strong>
            {label ? labelStatusText(label.status) : "Sem etiqueta criada"}
          </strong>
        </p>
        {label && (
          <>
            <p
              className={
                label.provider.endsWith(":sandbox")
                  ? "sandbox-note"
                  : "shipping-note"
              }
            >
              {label.provider === "melhorenvio:sandbox"
                ? "Ambiente de teste · Melhor Envio sandbox"
                : label.provider === "melhorenvio:production"
                  ? "Produção · Melhor Envio"
                  : "Provedor da etiqueta não reconhecido"}
            </p>
            <p className="shipment-identifier">
              ID da etiqueta: {label.id}
              {label.remoteId ? ` · ID no provedor: ${label.remoteId}` : ""}
            </p>
          </>
        )}
        {label &&
          ["REVIEW_REQUIRED", "CANCELED", "EXPIRED", "SUSPENDED"].includes(
            label.status,
          ) && (
            <p className="shipping-note">
              Esta etiqueta exige revisão no painel do Melhor Envio. Sincronize
              após conferir a situação no provedor.
            </p>
          )}
        {label &&
          ((label.status === "PENDING" && label.checkoutStartedAt) ||
            (label.status === "PURCHASED" && label.generateStartedAt)) && (
            <p className="shipping-note">
              Há uma solicitação anterior em análise. Sincronize a etiqueta para
              conferir o resultado.
            </p>
          )}
        {available && (
          <div className="shipment-actions">
            {actions.pack &&
              (review !== "pack" ? (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => {
                    setReview("pack");
                    setPacked(false);
                  }}
                >
                  Conferir embalagem
                </button>
              ) : (
                <div className="shipment-review">
                  <p>
                    Confira as cartas selecionadas e a proteção antes de
                    registrar a embalagem como preparada.
                  </p>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={packed}
                      onChange={(event) => setPacked(event.target.checked)}
                    />
                    Conferi as cartas e a proteção da embalagem
                  </label>
                  <div className="button-row">
                    <button
                      className="primary"
                      disabled={busy || !packed}
                      onClick={() => void run("pack")}
                    >
                      Confirmar embalagem preparada
                    </button>
                    <button
                      className="clear"
                      disabled={busy}
                      onClick={() => setReview(null)}
                    >
                      Voltar à conferência
                    </button>
                  </div>
                </div>
              ))}
            {actions.create && (
              <CreateLabelForm
                busy={busy}
                production={production}
                isCurrentSession={isCurrentSession}
                onSubmit={(input) => run("create", input)}
              />
            )}
            {actions.recover && (
              <RecoveryLabelForm
                busy={busy}
                isCurrentSession={isCurrentSession}
                onSubmit={(remoteId) => run("recover", remoteId)}
              />
            )}
            {actions.checkout && label?.cost && (
              <LabelCheckoutForm
                key={`${label.id}:${label.cost}:${label.provider}`}
                busy={busy}
                cost={label.cost}
                provider={label.provider}
                isCurrentSession={isCurrentSession}
                onSubmit={(cost) => run("checkout", cost)}
              />
            )}
            {actions.generate &&
              (review !== "generate" ? (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => setReview("generate")}
                >
                  Gerar etiqueta
                </button>
              ) : (
                <div className="shipment-review">
                  <p>
                    Solicitar a geração da etiqueta já comprada no Melhor Envio?
                  </p>
                  <div className="button-row">
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => void run("generate")}
                    >
                      Confirmar geração
                    </button>
                    <button
                      className="clear"
                      disabled={busy}
                      onClick={() => setReview(null)}
                    >
                      Voltar
                    </button>
                  </div>
                </div>
              ))}
            <div className="button-row">
              {actions.sync && (
                <button
                  className="outline"
                  disabled={busy}
                  onClick={() => void run("sync")}
                >
                  Sincronizar etiqueta
                </button>
              )}
              {actions.print && (
                <button
                  className="outline"
                  disabled={busy}
                  onClick={() => void run("print")}
                >
                  Obter link de impressão
                </button>
              )}
            </div>
          </div>
        )}
        {printUrl && (
          <a
            className="outline shipment-print-link"
            href={printUrl}
            target="_blank"
            rel="noopener noreferrer"
            referrerPolicy="no-referrer"
          >
            Abrir etiqueta para impressão ↗
          </a>
        )}
        <p className="muted shipment-help">
          Postagem e entrega são confirmadas pelo Melhor Envio. A sincronização
          consulta o provedor e atualiza o acompanhamento.
        </p>
      </section>
    </>
  );
}
