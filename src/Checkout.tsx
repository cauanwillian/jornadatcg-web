import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { authorized } from "./session";
import { money } from "./api";
import { ensureAttempt, forgetAttempt, loadAttempt } from "./purchase";
import type { CheckoutAttempt, Order, PixResult } from "./purchase";
export { MyOrders } from "./MyOrdersArea";

const labels: Record<string, string> = {
  PENDING_PAYMENT: "Aguardando pagamento",
  PAID: "Pagamento confirmado",
  PREPARING: "Em preparação",
  READY_TO_SHIP: "Pronto para envio",
  SHIPPED: "Enviado",
  DELIVERED: "Entregue",
  CANCELLED: "Cancelado",
};
const dateTime = (value: string | null) =>
  value ? new Date(value).toLocaleString("pt-BR") : "Consulte o pedido";
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Não foi possível concluir. Tente novamente.";

function readAttempt(userId: string) {
  try {
    return { attempt: loadAttempt(userId), error: "" };
  } catch (error) {
    return { attempt: null, error: message(error) };
  }
}

export function Checkout({
  userId,
  subtotal,
  canCheckout,
  initialOrder,
  onCreated,
  onReviewCart,
  onBusyChange = () => {},
  isCurrentSession = () => true,
}: {
  userId: string;
  subtotal: string;
  canCheckout: boolean;
  initialOrder?: Order;
  onCreated: () => void;
  onReviewCart: () => void;
  onBusyChange?: (busy: boolean) => void;
  isCurrentSession?: () => boolean;
}) {
  const [stored] = useState(() => readAttempt(userId));
  const [attempt, setAttempt] = useState<CheckoutAttempt | null>(
    stored.attempt,
  );
  const [order, setOrder] = useState<Order | null>(initialOrder ?? null);
  const [pix, setPix] = useState<PixResult | null>(null);
  const [error, setError] = useState(stored.error);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [reviewRequired, setReviewRequired] = useState(false);
  const [cpf, setCpf] = useState("");
  const [copied, setCopied] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const mutation = useRef(false);
  const alive = useRef(true);
  const revision = useRef(0);
  const reload = useRef<() => Promise<void>>(async () => {});
  const orderId = order?.id;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!orderId) return;
    let active = true;
    let reading = false;
    let finished = false;
    const controller = new AbortController();
    const load = async () => {
      if (!active || reading || mutation.current) return;
      reading = true;
      setChecking(true);
      const started = revision.current;
      try {
        let fresh = await authorized<Order>(`/orders/${orderId}`, {
          signal: controller.signal,
        });
        let result: PixResult | null = null;
        if (fresh.status === "PENDING_PAYMENT") {
          try {
            result = await authorized<PixResult>(
              `/orders/${orderId}/payments/pix`,
              { signal: controller.signal },
            );
          } catch (err) {
            if ((err as { status?: number }).status !== 404) throw err;
          }
          // Reading Pix reconciles the payment. Fetch the authoritative order
          // again after settlement, rather than marking it paid in the browser.
          if (result?.payment.status === "PAID") {
            fresh = await authorized<Order>(`/orders/${orderId}`, {
              signal: controller.signal,
            });
          }
        }
        if (active && revision.current === started) {
          setOrder(fresh);
          setPix(result);
          setError("");
          finished =
            fresh.status !== "PENDING_PAYMENT" ||
            (result != null && result.payment.status !== "PENDING");
          if (finished) setCpf("");
        }
      } catch (err) {
        if (active && revision.current === started) setError(message(err));
      } finally {
        reading = false;
        if (active) setChecking(false);
      }
    };
    reload.current = load;
    void load();
    const timer = window.setInterval(() => {
      if (!finished && document.visibilityState === "visible") void load();
    }, 15_000);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(timer);
      window.clearInterval(clock);
      reload.current = async () => {};
    };
  }, [orderId]);

  async function createOrder() {
    if (mutation.current || reviewRequired || (!attempt && !canCheckout))
      return;
    mutation.current = true;
    onBusyChange(true);
    revision.current++;
    setBusy(true);
    setError("");
    let saved: CheckoutAttempt | null = null;
    try {
      if (!isCurrentSession())
        throw new Error("Sua sessão mudou. Abra a compra novamente.");
      // Save before the first POST. Retries and reloads reuse the original
      // amount and key, even if the cart has already been emptied by checkout.
      saved = ensureAttempt(userId, subtotal);
      setAttempt(saved);
      const created = await authorized<Order>("/orders", {
        method: "POST",
        headers: { "Idempotency-Key": saved.key },
        body: JSON.stringify({ expectedSubtotal: saved.expectedSubtotal }),
      });
      if (!alive.current || !isCurrentSession()) return;
      forgetAttempt(userId, saved.key);
      setAttempt(null);
      setOrder(created);
      onCreated();
    } catch (err) {
      if (!alive.current || !isCurrentSession()) return;
      const status = (err as { status?: number }).status;
      // A known stock/price rejection did not create an order. An idempotency
      // conflict or an ambiguous transport failure must retain the saved key.
      if (
        (status === 400 || status === 409) &&
        !message(err).includes("Idempotency-Key")
      ) {
        if (saved) forgetAttempt(userId, saved.key);
        setAttempt(null);
        setReviewRequired(true);
      }
      setError(message(err));
    } finally {
      mutation.current = false;
      if (alive.current) {
        setBusy(false);
        onBusyChange(false);
      }
    }
  }

  async function createPix(event: FormEvent) {
    event.preventDefault();
    if (!order || mutation.current || checking) return;
    mutation.current = true;
    onBusyChange(true);
    revision.current++;
    setBusy(true);
    setError("");
    let issued = false;
    try {
      if (!isCurrentSession())
        throw new Error("Sua sessão mudou. Abra a compra novamente.");
      const result = await authorized<PixResult>(
        `/orders/${order.id}/payments/pix`,
        {
          method: "POST",
          body: JSON.stringify({ cpf: cpf.replace(/\D/g, "") }),
        },
      );
      if (!alive.current || !isCurrentSession()) return;
      setPix(result);
      setCpf("");
      issued = true;
    } catch (err) {
      if (!alive.current || !isCurrentSession()) return;
      setError(
        message(err) +
          " Atualize o pagamento para consultar esta cobrança antes de tentar novamente.",
      );
    } finally {
      mutation.current = false;
      if (alive.current) {
        setBusy(false);
        onBusyChange(false);
      }
    }
    // Only GETs may follow creation; never automatically issue another Pix POST.
    if (issued) await reload.current();
  }

  async function copyPix() {
    if (!pix?.pix) return;
    try {
      await navigator.clipboard.writeText(pix.pix.payload);
      setCopied("Código Pix copiado.");
    } catch {
      setCopied("Selecione e copie o código abaixo.");
    }
  }

  if (!order) {
    return (
      <section className="checkout" aria-label="Revisão da compra">
        <p className="muted">Confira o valor antes de confirmar seu pedido.</p>
        <div className="cart-total">
          <span>Total das cartas</span>
          <strong>{money(attempt?.expectedSubtotal ?? subtotal)}</strong>
        </div>
        <p className="shipping-note">
          Suas compras pagas ficam guardadas na loja. Você solicita o envio
          quando quiser; o frete será calculado e pago separadamente.
        </p>
        {attempt && (
          <p role="status">
            Existe uma tentativa de compra em andamento. Vamos recuperar o mesmo
            pedido.
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button
          className="primary"
          disabled={busy || reviewRequired || (!attempt && !canCheckout)}
          onClick={() => void createOrder()}
        >
          {busy
            ? "Consultando pedido…"
            : attempt
              ? "Recuperar pedido"
              : "Confirmar pedido"}
        </button>
        <button
          className="checkout-back"
          disabled={busy}
          onClick={onReviewCart}
        >
          Revisar carrinho
        </button>
      </section>
    );
  }

  const paid = !["PENDING_PAYMENT", "CANCELLED"].includes(order.status);
  const deadline = pix?.reservationExpiresAt ?? order.expiresAt;
  const expired = deadline != null && new Date(deadline).getTime() <= now;
  const paymentClosed = pix != null && pix.payment.status !== "PENDING";
  const canPay =
    !paid && order.status === "PENDING_PAYMENT" && !expired && !paymentClosed;
  return (
    <section className="checkout" aria-label={`Pedido ${order.orderNumber}`}>
      <p className="eyebrow">PEDIDO #{order.orderNumber}</p>
      <p className={`order-status${paid ? " paid" : ""}`} role="status">
        {labels[order.status] ?? order.status}
      </p>
      <div className="order-lines">
        {order.items.map((item) => (
          <div key={item.id}>
            <span>
              {item.quantity}× {item.cardName}
              <small>
                {item.conditionName} · {item.languageName}
              </small>
            </span>
            <strong>{money(item.totalPrice)}</strong>
          </div>
        ))}
      </div>
      <div className="cart-total">
        <span>Total das cartas</span>
        <strong>{money(order.total)}</strong>
      </div>
      <p className="shipping-note">
        Frete solicitado e pago separadamente, quando você decidir enviar suas
        compras acumuladas.
      </p>
      {paid ? (
        <p className="payment-success">
          {order.status === "PAID"
            ? "Pagamento confirmado. Suas cartas ficam disponíveis para acumular com novas compras."
            : "Pagamento confirmado. Acompanhe acima o andamento do seu pedido."}
        </p>
      ) : order.status === "CANCELLED" ? (
        <p>Este pedido foi cancelado.</p>
      ) : (
        <>
          <p className="muted">Prazo de pagamento: {dateTime(deadline)}.</p>
          {expired && (
            <p className="error">
              O prazo exibido terminou. Atualize o pagamento para conferir a
              situação do pedido.
            </p>
          )}
          {pix?.payment.provider === "asaas:sandbox" && (
            <p className="sandbox-note">
              Ambiente de testes: este Pix é do sandbox Asaas.
            </p>
          )}
          {canPay && pix?.pix ? (
            <div className="pix-panel">
              <h3>Pague com Pix</h3>
              <img
                className="pix-qr"
                src={`data:image/png;base64,${pix.pix.encodedImage}`}
                alt={`QR Code Pix do pedido ${order.orderNumber}`}
              />
              <label>
                Código Pix copia e cola
                <textarea
                  readOnly
                  value={pix.pix.payload}
                  onFocus={(event) => event.target.select()}
                />
              </label>
              <button className="primary" onClick={() => void copyPix()}>
                Copiar código Pix
              </button>
              {copied && <p role="status">{copied}</p>}
              <p className="muted">
                A confirmação será consultada automaticamente enquanto esta
                janela estiver aberta.
              </p>
            </div>
          ) : canPay ? (
            <form onSubmit={(event) => void createPix(event)}>
              {pix && (
                <p>
                  A cobrança está em processamento. Atualize o pagamento para
                  acompanhar.
                </p>
              )}
              <label>
                CPF do pagador
                <input
                  name="cpf"
                  inputMode="numeric"
                  autoComplete="off"
                  required
                  maxLength={14}
                  pattern="[0-9.\- ]{11,14}"
                  value={cpf}
                  onChange={(event) => setCpf(event.target.value)}
                  placeholder="000.000.000-00"
                />
              </label>
              <p className="muted">
                O CPF será validado pela API e vinculado ao seu cadastro para
                emissão da cobrança.
              </p>
              <button
                className="primary"
                disabled={
                  busy || checking || cpf.replace(/\D/g, "").length !== 11
                }
              >
                {busy ? "Gerando Pix…" : "Gerar Pix"}
              </button>
            </form>
          ) : (
            paymentClosed && (
              <p>
                Pagamento{" "}
                {(
                  {
                    EXPIRED: "expirado",
                    FAILED: "não concluído",
                    REFUNDED: "reembolsado",
                    CANCELLED: "cancelado",
                    PAID: "recebido; aguardando atualização do pedido",
                  } as Record<string, string>
                )[pix.payment.status] ?? pix.payment.status}
                .
              </p>
            )
          )}
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button
        className="checkout-back"
        disabled={busy || checking}
        onClick={() => void reload.current()}
      >
        {checking ? "Consultando…" : "Atualizar pagamento"}
      </button>
    </section>
  );
}
