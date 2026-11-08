import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { authorized } from "./session";
import { money } from "./api";
import { AddressPicker } from "./ShippingAddresses";
import { FreightPayment } from "./FreightPayment";
import {
  ensureShipmentAttempt,
  forgetShipmentAttempt,
  loadShipmentAttempt,
} from "./shipping";
import type {
  AvailableItem,
  AvailablePage,
  QuoteBatch,
  QuoteSelection,
  Shipment,
  ShipmentAttempt,
  ShipmentsPage,
} from "./shipping";
import type { PixResult } from "./purchase";

const statuses: Record<Shipment["status"], string> = {
  ACCUMULATING: "Em acúmulo",
  PENDING: "Aguardando frete",
  PREPARING: "Preparando envio",
  READY_TO_SHIP: "Pronto para postagem",
  SHIPPED: "Postado",
  DELIVERED: "Entregue",
  CANCELLED: "Cancelado",
};
const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Não foi possível concluir. Tente novamente.";
const dateTime = (value: string) => new Date(value).toLocaleString("pt-BR");
function savedAttempt(userId: string) {
  try {
    return { attempt: loadShipmentAttempt(userId), error: "" };
  } catch (error) {
    return { attempt: null, error: errorText(error) };
  }
}
function detailError(error: unknown) {
  const status = (error as { status?: number } | null)?.status;
  if (status === 404 || status === 403)
    return "Envio não encontrado ou indisponível para esta conta.";
  if (status === 401)
    return "Sua sessão expirou. Entre novamente para consultar o envio.";
  return "Não foi possível consultar o envio. Atualize e tente novamente.";
}

export function Shipping({
  userId,
  initialShipmentId,
  isCurrentSession,
  onBusyChange,
}: {
  userId: string;
  initialShipmentId?: string;
  isCurrentSession: () => boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const [stored] = useState(() => savedAttempt(userId));
  const [attempt, setAttempt] = useState<ShipmentAttempt | null>(
    stored.attempt,
  );
  const [view, setView] = useState<"available" | "requests" | "detail">(
    initialShipmentId ? "detail" : "available",
  );
  const [available, setAvailable] = useState<AvailablePage | null>(null);
  const [requests, setRequests] = useState<ShipmentsPage | null>(null);
  const [page, setPage] = useState(1);
  const [requestsPage, setRequestsPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [selected, setSelected] = useState<
    Record<string, { item: AvailableItem; quantity: number }>
  >({});
  const [addressId, setAddressId] = useState("");
  const [current, setCurrent] = useState<Shipment | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(
    initialShipmentId ?? null,
  );
  const [batch, setBatch] = useState<QuoteBatch | null>(null);
  const [detailStale, setDetailStale] = useState(false);
  const [payment, setPayment] = useState<PixResult | null | undefined>(
    undefined,
  );
  const [error, setError] = useState(stored.error);
  const [cancelReview, setCancelReview] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const lock = useRef(false);
  const alive = useRef(true);
  const session = useRef(isCurrentSession);
  useLayoutEffect(() => {
    session.current = isCurrentSession;
  }, [isCurrentSession]);
  const refreshDetail = useRef<() => Promise<void>>(async () => {});
  const selections = Object.values(selected);
  const count = selections.reduce((sum, item) => sum + item.quantity, 0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (view === "detail") return;
    let active = true;
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      try {
        if (view === "available") {
          const data = await authorized<AvailablePage>(
            `/shipments/available-items?page=${page}&pageSize=20`,
            { signal: controller.signal },
          );
          if (active && session.current()) setAvailable(data);
        } else {
          const data = await authorized<ShipmentsPage>(
            `/shipments?page=${requestsPage}&pageSize=20`,
            { signal: controller.signal },
          );
          if (active && session.current()) setRequests(data);
        }
      } catch (err) {
        if (active && session.current()) setError(errorText(err));
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [view, page, requestsPage, refresh]);

  useEffect(() => {
    if (view !== "detail" || !currentId) return;
    let active = true;
    let reading = false;
    let request: AbortController | null = null;
    const load = async () => {
      if (!active || reading || !session.current()) return;
      reading = true;
      setChecking(true);
      setError("");
      const controller = new AbortController();
      request = controller;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let onAbort = () => {};
      try {
        const data = await Promise.race([
          authorized<Shipment>(`/shipments/${currentId}`, {
            signal: controller.signal,
          }),
          new Promise<never>((_, reject) => {
            onAbort = () => reject(new Error("Consulta interrompida."));
            controller.signal.addEventListener("abort", onAbort, {
              once: true,
            });
            timeout = setTimeout(() => {
              controller.abort();
              reject(new Error("Prazo da consulta encerrado."));
            }, 15_000);
          }),
        ]);
        if (active && session.current()) {
          if (data.id !== currentId) throw new Error("Invalid shipment.");
          setCurrent(data);
          setDetailStale(false);
        }
      } catch (err) {
        if (active && session.current()) {
          setDetailStale(true);
          setError(detailError(err));
        }
      } finally {
        clearTimeout(timeout);
        controller.signal.removeEventListener("abort", onAbort);
        if (request === controller) request = null;
        reading = false;
        if (active) setChecking(false);
      }
    };
    refreshDetail.current = load;
    void load();
    const clock = window.setInterval(() => {
      if (active && session.current()) setNow(Date.now());
    }, 1000);
    return () => {
      active = false;
      request?.abort();
      window.clearInterval(clock);
      refreshDetail.current = async () => {};
    };
  }, [view, currentId]);

  function markBusy(value: boolean) {
    lock.current = value;
    setBusy(value);
    onBusyChange(value);
  }
  async function action(work: () => Promise<void>) {
    if (lock.current || !isCurrentSession()) return;
    markBusy(true);
    setError("");
    try {
      await work();
    } catch (err) {
      if (alive.current && isCurrentSession()) setError(errorText(err));
    } finally {
      if (alive.current && isCurrentSession()) markBusy(false);
    }
  }
  function showShipment(shipment: Shipment) {
    setCurrentId(shipment.id);
    setCurrent(shipment);
    setPayment(undefined);
    setBatch(null);
    setDetailStale(true);
    setCancelReview(false);
    setError("");
    setView("detail");
  }
  function navigate(value: "available" | "requests") {
    if (lock.current) return;
    setError("");
    setLoading(true);
    setView(value);
    setRefresh((value) => value + 1);
  }
  async function createShipment() {
    await action(async () => {
      let saved: ShipmentAttempt | null = null;
      try {
        saved = ensureShipmentAttempt(userId, {
          addressId,
          items: selections.map(({ item, quantity }) => ({
            orderItemId: item.orderItemId,
            quantity,
          })),
        });
        setAttempt(saved);
        // UUID is also the shipment ID: recovery checks for an existing request
        // first, then explicitly replays the original POST only on a 404.
        let shipment: Shipment;
        try {
          shipment = await authorized<Shipment>(`/shipments/${saved.key}`);
        } catch (err) {
          if ((err as { status?: number }).status !== 404) throw err;
          if (!isCurrentSession())
            throw new Error("Sua sessão mudou. Abra os envios novamente.");
          shipment = await authorized<Shipment>("/shipments", {
            method: "POST",
            headers: { "Idempotency-Key": saved.key },
            body: JSON.stringify(saved.input),
          });
        }
        if (!alive.current || !isCurrentSession()) return;
        const actualItems = shipment.items
          .map(({ orderItemId, quantity }) => ({ orderItemId, quantity }))
          .sort((a, b) => a.orderItemId.localeCompare(b.orderItemId));
        if (
          shipment.id !== saved.key ||
          shipment.address.addressId !== saved.input.addressId ||
          JSON.stringify(actualItems) !== JSON.stringify(saved.input.items)
        ) {
          throw new Error(
            "A confirmação salva não corresponde a este envio. Consulte Meus envios antes de continuar.",
          );
        }
        forgetShipmentAttempt(userId, saved.key);
        setAttempt(null);
        setSelected({});
        showShipment(shipment);
      } catch (err) {
        if (!alive.current || !isCurrentSession()) return;
        const status = (err as { status?: number }).status;
        // Only a definitive business rejection permits revising the selection.
        // Conflicts that explicitly require the original key retain the attempt.
        if (
          saved &&
          (status === 400 ||
            status === 404 ||
            (status === 409 && !errorText(err).includes("Idempotency-Key")))
        ) {
          forgetShipmentAttempt(userId, saved.key);
          setAttempt(null);
        }
        throw err;
      }
    });
  }
  async function calculate() {
    if (
      !current ||
      current.status !== "PENDING" ||
      current.shippingPaidAt ||
      payment !== null
    )
      return;
    await action(async () => {
      setDetailStale(true);
      setBatch(null);
      const result = await authorized<QuoteBatch>(
        `/shipments/${current.id}/quotes`,
        { method: "POST" },
      );
      if (!alive.current || !isCurrentSession()) return;
      setBatch(result);
      setCancelReview(false);
      await refreshDetail.current();
    });
  }
  async function selectQuote(optionId: string) {
    if (
      !current ||
      current.status !== "PENDING" ||
      !!current.shippingPaidAt ||
      payment !== null ||
      !batch ||
      new Date(batch.expiresAt).getTime() <= now
    )
      return;
    await action(async () => {
      setDetailStale(true);
      await authorized<QuoteSelection>(
        `/shipments/${current.id}/quotes/${optionId}/select`,
        { method: "POST" },
      );
      if (!alive.current || !isCurrentSession()) return;
      await refreshDetail.current();
    });
  }
  async function cancelShipment() {
    if (!current || !cancelReview) return;
    await action(async () => {
      setDetailStale(true);
      const result = await authorized<Shipment>(
        `/shipments/${current.id}/cancel`,
        { method: "POST" },
      );
      if (!alive.current || !isCurrentSession()) return;
      setCurrent(result);
      setDetailStale(false);
      setBatch(null);
      setCancelReview(false);
    });
  }

  const canCancel =
    current?.status === "PENDING" &&
    !current.shippingPaidAt &&
    !current.trackingCode &&
    payment !== undefined &&
    (payment === null ||
      ["EXPIRED", "CANCELLED", "FAILED"].includes(payment.payment.status));
  const selectedCount = attempt
    ? attempt.input.items.reduce((sum, item) => sum + item.quantity, 0)
    : count;
  return (
    <section className="shipping-area" aria-label="Compras acumuladas e envios">
      <nav className="shipping-tabs" aria-label="Área de envios">
        <button
          aria-pressed={view === "available"}
          disabled={busy}
          onClick={() => navigate("available")}
        >
          Compras acumuladas
        </button>
        <button
          aria-pressed={view === "requests"}
          disabled={busy}
          onClick={() => navigate("requests")}
        >
          Meus envios
        </button>
      </nav>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {view === "available" ? (
        <>
          <p className="muted">
            Escolha as cartas pagas que deseja receber. As demais continuam
            guardadas na loja.
          </p>
          {available && (
            <div className="accumulated-summary">
              <strong>
                {available.summary.availableQuantity} cartas disponíveis
              </strong>
              <span>
                {money(available.summary.availableValue)} em compras pagas
              </span>
            </div>
          )}
          {attempt && (
            <div className="shipping-note">
              <p>
                Há uma solicitação anterior para {selectedCount} cartas.
                Recupere o mesmo envio antes de iniciar outro.
              </p>
              <button
                className="primary"
                disabled={busy}
                onClick={() => void createShipment()}
              >
                {busy ? "Recuperando…" : "Recuperar solicitação"}
              </button>
            </div>
          )}
          <fieldset
            disabled={busy || !!attempt || loading}
            className="shipping-fieldset"
          >
            {available?.items.map((item) => {
              const chosen = selected[item.orderItemId];
              return (
                <article className="accumulated-item" key={item.orderItemId}>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={!!chosen}
                      disabled={!chosen && count >= 70}
                      onChange={(event) => {
                        setSelected((previous) => {
                          const next = { ...previous };
                          if (event.target.checked)
                            next[item.orderItemId] = { item, quantity: 1 };
                          else delete next[item.orderItemId];
                          return next;
                        });
                      }}
                    />{" "}
                    <span>
                      <strong>{item.cardName}</strong>
                      <small>
                        Pedido #{item.orderNumber} · {item.setName} ·{" "}
                        {item.cardNumber}
                      </small>
                      <small>
                        {item.conditionName} · {item.languageName} ·{" "}
                        {item.availableQuantity} disponíveis
                      </small>
                    </span>
                  </label>
                  {chosen && (
                    <label>
                      Quantidade de {item.cardName}
                      <input
                        type="number"
                        min={1}
                        max={Math.min(
                          item.availableQuantity,
                          70 - count + chosen.quantity,
                        )}
                        value={chosen.quantity}
                        onChange={(event) => {
                          const quantity = Number(event.target.value);
                          if (
                            Number.isInteger(quantity) &&
                            quantity >= 1 &&
                            quantity <= item.availableQuantity &&
                            count - chosen.quantity + quantity <= 70
                          ) {
                            setSelected((previous) => ({
                              ...previous,
                              [item.orderItemId]: { item, quantity },
                            }));
                          }
                        }}
                      />
                    </label>
                  )}
                </article>
              );
            })}
          </fieldset>
          {loading && <p role="status">Carregando compras…</p>}
          {!loading && available?.items.length === 0 && (
            <p>Você ainda não tem cartas pagas disponíveis para envio.</p>
          )}
          <div className="shipping-pagination">
            <button
              disabled={busy || loading || page <= 1}
              onClick={() => {
                setLoading(true);
                setPage((value) => value - 1);
              }}
            >
              Anterior
            </button>
            <span>Página {page}</span>
            <button
              disabled={
                busy || loading || !available || page * 20 >= available.total
              }
              onClick={() => {
                setLoading(true);
                setPage((value) => value + 1);
              }}
            >
              Próxima
            </button>
          </div>
          <button
            className="checkout-back"
            disabled={busy || loading}
            onClick={() => {
              setError("");
              setRefresh((value) => value + 1);
            }}
          >
            Atualizar compras
          </button>
          <div className="selection-summary">
            <strong>{selectedCount} de 70 cartas selecionadas</strong>
            {!attempt && selections.length > 0 && (
              <ul>
                {selections.map(({ item, quantity }) => (
                  <li key={item.orderItemId}>
                    {quantity}× {item.cardName} (pedido #{item.orderNumber})
                  </li>
                ))}
              </ul>
            )}
            <p className="muted">
              Cada solicitação comporta até 70 cartas. Para quantidades maiores,
              divida em mais envios.
            </p>
          </div>
          <AddressPicker
            value={addressId}
            onChange={setAddressId}
            disabled={busy || !!attempt}
            isCurrentSession={isCurrentSession}
            onBusyChange={markBusy}
          />
          {!attempt && (
            <>
              <p className="shipping-note">
                O endereço e as cartas serão vinculados a esta solicitação. Em
                seguida você poderá calcular, escolher e pagar o frete.
              </p>
              <button
                className="primary"
                disabled={
                  busy || loading || !addressId || count === 0 || count > 70
                }
                onClick={() => void createShipment()}
              >
                {busy ? "Solicitando…" : "Solicitar envio"}
              </button>
            </>
          )}
        </>
      ) : view === "requests" ? (
        <>
          <p className="muted">
            Acompanhe o frete, o pagamento e a postagem das suas compras.
          </p>
          {requests?.items.map((shipment) => (
            <button
              className="order-row"
              key={shipment.id}
              disabled={busy || loading}
              onClick={() => showShipment(shipment)}
            >
              <span>
                <strong>{statuses[shipment.status]}</strong>
                <small>
                  {dateTime(shipment.createdAt)} ·{" "}
                  {shipment.items.reduce((sum, item) => sum + item.quantity, 0)}{" "}
                  cartas
                </small>
                <span>{shipment.quote?.serviceName ?? "Frete a definir"}</span>
              </span>
              <strong>
                {shipment.shippingCost === null
                  ? "A cotar"
                  : money(shipment.shippingCost)}
              </strong>
            </button>
          ))}
          {loading && <p role="status">Carregando envios…</p>}
          {!loading && requests?.items.length === 0 && (
            <p>Você ainda não tem solicitações de envio.</p>
          )}
          <div className="shipping-pagination">
            <button
              disabled={busy || loading || requestsPage <= 1}
              onClick={() => setRequestsPage((value) => value - 1)}
            >
              Anterior
            </button>
            <span>Página {requestsPage}</span>
            <button
              disabled={
                busy ||
                loading ||
                !requests ||
                requestsPage * 20 >= requests.total
              }
              onClick={() => setRequestsPage((value) => value + 1)}
            >
              Próxima
            </button>
          </div>
          <button
            className="checkout-back"
            disabled={busy || loading}
            onClick={() => {
              setError("");
              setRefresh((value) => value + 1);
            }}
          >
            Atualizar envios
          </button>
        </>
      ) : !current ? (
        <>
          {checking && <p role="status">Carregando envio…</p>}
          <button
            className="checkout-back"
            disabled={busy || checking}
            onClick={() => void refreshDetail.current()}
          >
            {checking ? "Consultando envio…" : "Atualizar envio"}
          </button>
          <button
            className="clear"
            disabled={busy}
            onClick={() => navigate("requests")}
          >
            Voltar para meus envios
          </button>
        </>
      ) : (
        current && (
          <>
            <p
              className={`order-status${current.shippingPaidAt ? " paid" : ""}`}
            >
              {statuses[current.status]}
            </p>
            <p className="muted">Solicitado em {dateTime(current.createdAt)}</p>
            <div className="address-preview">
              <strong>{current.address.recipientName}</strong>
              <p>
                {current.address.street}, {current.address.number}
                {current.address.complement
                  ? ` · ${current.address.complement}`
                  : ""}
                <br />
                {current.address.neighborhood} · {current.address.city}/
                {current.address.state}
                <br />
                CEP {current.address.zipCode}
              </p>
            </div>
            <div className="order-lines">
              {current.items.map((item) => (
                <div key={item.orderItemId}>
                  <span>
                    {item.quantity}× {item.cardName}
                    <small>
                      {item.conditionName} · {item.languageName}
                    </small>
                  </span>
                  <strong>{money(item.subtotal)}</strong>
                </div>
              ))}
            </div>
            {current.trackingCode && (
              <p className="tracking-code">
                Código de rastreio: <strong>{current.trackingCode}</strong>
              </p>
            )}
            {current.shippedAt && (
              <p className="muted">Postado em {dateTime(current.shippedAt)}</p>
            )}
            {current.deliveredAt && (
              <p className="payment-success">
                Entregue em {dateTime(current.deliveredAt)}
              </p>
            )}
            <div className="cart-total">
              <span>Frete</span>
              <strong>
                {current.shippingCost === null
                  ? "A calcular"
                  : money(current.shippingCost)}
              </strong>
            </div>
            {current.quote && (
              <p>
                {current.quote.carrier} · {current.quote.serviceName} · prazo
                estimado de {current.quote.deliveryDays} dias após postagem.
              </p>
            )}
            {detailStale && (
              <p className="muted">
                Atualize os dados do envio antes de continuar.
              </p>
            )}
            {current.status === "PENDING" &&
              !current.shippingPaidAt &&
              !payment && (
                <button
                  className="primary"
                  disabled={busy || checking || detailStale || payment !== null}
                  onClick={() => void calculate()}
                >
                  {current.selectedQuoteId
                    ? "Recalcular frete"
                    : "Calcular frete"}
                </button>
              )}
            {batch &&
              !payment &&
              current.status === "PENDING" &&
              !current.shippingPaidAt && (
                <div className="freight-options">
                  <h3>Escolha uma opção de frete</h3>
                  <p className="muted">
                    Valores válidos até {dateTime(batch.expiresAt)}. Prazo
                    estimado após a postagem.
                  </p>
                  {batch.providers.some(
                    (provider) => provider.status !== "OK",
                  ) && (
                    <p className="muted">
                      Alguns serviços não retornaram opções nesta consulta.
                    </p>
                  )}
                  {batch.options.length === 0 && (
                    <p>
                      Nenhuma opção disponível para este endereço nesta
                      consulta.
                    </p>
                  )}
                  {batch.options.map((option) => (
                    <div className="freight-option" key={option.id}>
                      <span>
                        <strong>
                          {option.carrier} · {option.serviceName}
                        </strong>
                        <small>
                          {option.deliveryDays} dias ·{" "}
                          {option.provider.endsWith(":sandbox")
                            ? "Cotação de teste"
                            : "Cotação da transportadora"}
                        </small>
                      </span>
                      <strong>{money(option.amount)}</strong>
                      <button
                        className="outline"
                        disabled={
                          busy ||
                          checking ||
                          detailStale ||
                          payment !== null ||
                          now >= new Date(option.expiresAt).getTime()
                        }
                        onClick={() => void selectQuote(option.id)}
                      >
                        {current.selectedQuoteId === option.id
                          ? "Selecionado"
                          : "Escolher"}
                      </button>
                    </div>
                  ))}
                  {now >= new Date(batch.expiresAt).getTime() && (
                    <p className="error">
                      Cotação expirada. Calcule o frete novamente.
                    </p>
                  )}
                </div>
              )}
            {!detailStale && current.status !== "CANCELLED" && (
              <fieldset
                className="shipping-fieldset"
                disabled={busy || checking}
              >
                <FreightPayment
                  key={current.id}
                  shipmentId={current.id}
                  shippingCost={current.shippingCost}
                  shippingPaidAt={current.shippingPaidAt}
                  quoteExpiresAt={current.quote?.expiresAt ?? null}
                  shipmentStatus={current.status}
                  isCurrentSession={isCurrentSession}
                  onBusyChange={(value) => {
                    if (value) setPayment((previous) => previous ?? undefined);
                    markBusy(value);
                  }}
                  onResolved={(result) => {
                    setPayment((previous) =>
                      previous && !result ? previous : result,
                    );
                    if (result?.payment.status === "PAID")
                      void refreshDetail.current();
                  }}
                />
              </fieldset>
            )}
            <button
              className="checkout-back"
              disabled={busy || checking}
              onClick={() => void refreshDetail.current()}
            >
              {checking ? "Consultando envio…" : "Atualizar envio"}
            </button>
            {canCancel && !detailStale && (
              <div className="cancel-shipment">
                {cancelReview ? (
                  <>
                    <p>
                      Cancelar esta solicitação libera as cartas para um novo
                      envio. Deseja continuar?
                    </p>
                    <button
                      className="checkout-back"
                      disabled={busy || checking}
                      onClick={() => void cancelShipment()}
                    >
                      Confirmar cancelamento
                    </button>
                    <button
                      className="clear"
                      disabled={busy}
                      onClick={() => setCancelReview(false)}
                    >
                      Manter solicitação
                    </button>
                  </>
                ) : (
                  <button
                    className="checkout-back"
                    disabled={busy || checking}
                    onClick={() => setCancelReview(true)}
                  >
                    Cancelar solicitação
                  </button>
                )}
              </div>
            )}
          </>
        )
      )}
    </section>
  );
}
