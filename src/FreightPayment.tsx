import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { money } from "./api";
import type { PixResult } from "./purchase";
import { authorized } from "./session";

interface FreightPaymentProps {
  shipmentId: string;
  shippingCost: string | null;
  shippingPaidAt: string | null;
  quoteExpiresAt: string | null;
  shipmentStatus: string;
  isCurrentSession: () => boolean;
  onBusyChange: (busy: boolean) => void;
  onResolved: (result: PixResult | null) => void;
}

function errorMessage(error: unknown) {
  return error instanceof Error && !(error instanceof TypeError)
    ? error.message
    : "Não foi possível consultar o pagamento. Atualize e tente novamente.";
}

function futureDate(value: string | null | undefined, now: number) {
  if (!value) return false;
  const date = Date.parse(value);
  return Number.isFinite(date) && date > now;
}

function resumableIntent(error: unknown) {
  return (
    error instanceof Error &&
    (error as Error & { status?: number }).status === 503 &&
    error.message ===
      "Criação do Pix ainda não concluída. Repita a solicitação para o mesmo pedido."
  );
}

const terminalLabels: Record<string, string> = {
  FAILED: "Pagamento do frete não concluído.",
  EXPIRED: "Pagamento do frete expirado.",
  REFUNDED: "Pagamento do frete reembolsado.",
  CANCELLED: "Pagamento do frete cancelado.",
};

function FreightPaymentContent(props: FreightPaymentProps) {
  const {
    shipmentId,
    shippingCost,
    shippingPaidAt,
    quoteExpiresAt,
    shipmentStatus,
  } = props;
  const [result, setResult] = useState<PixResult | null>(null);
  const [known, setKnown] = useState(false);
  const [canResumeIntent, setCanResumeIntent] = useState(false);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cpf, setCpf] = useState("");
  const [readError, setReadError] = useState("");
  const [postError, setPostError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [copied, setCopied] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const latest = useRef(props);
  const mounted = useRef(false);
  const mutation = useRef(false);
  const revision = useRef(0);
  const payment = useRef<PixResult | null>(null);
  const reload = useRef<(manual?: boolean) => Promise<void>>(async () => {});

  useEffect(() => {
    latest.current = props;
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    let reading = false;
    const controller = new AbortController();
    const valid = () =>
      active &&
      mounted.current &&
      latest.current.shipmentId === shipmentId &&
      latest.current.isCurrentSession();
    const load = async (manual = false) => {
      if (
        !valid() ||
        reading ||
        mutation.current ||
        (!manual && document.visibilityState !== "visible")
      )
        return;
      reading = true;
      setChecking(true);
      const started = revision.current;
      try {
        let resolved: PixResult | null = null;
        try {
          resolved = await authorized<PixResult>(
            `/shipments/${shipmentId}/payments/pix`,
            { signal: controller.signal },
          );
        } catch (error) {
          if ((error as { status?: number }).status !== 404) throw error;
        }
        if (!valid() || revision.current !== started) return;
        payment.current = resolved;
        setResult(resolved);
        setKnown(true);
        setCanResumeIntent(false);
        setReadError("");
        // A failed creation stays visible until the customer explicitly checks.
        if (manual) {
          setPostError("");
          setUncertain(false);
        }
        if (resolved && resolved.payment.status !== "PENDING") setCpf("");
        latest.current.onResolved(resolved);
      } catch (error) {
        if (valid() && revision.current === started) {
          const resumable = resumableIntent(error);
          setKnown(false);
          setCanResumeIntent(resumable);
          setReadError(
            resumable
              ? "A criação do Pix não foi concluída. Informe o CPF para retomar a cobrança deste mesmo envio."
              : errorMessage(error),
          );
          if (manual && resumable) {
            setPostError("");
            setUncertain(false);
          }
        }
      } finally {
        reading = false;
        if (valid()) setChecking(false);
      }
    };
    const poll = () => {
      const current = latest.current;
      if (
        !current.shippingPaidAt &&
        current.shipmentStatus === "PENDING" &&
        (!payment.current || payment.current.payment.status === "PENDING")
      )
        void load();
    };
    reload.current = load;
    // Read even without a current quote: an earlier charge may still exist.
    void load();
    const timer = window.setInterval(poll, 15_000);
    const clock = window.setInterval(() => {
      if (valid()) setNow(Date.now());
    }, 1000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") poll();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(timer);
      window.clearInterval(clock);
      document.removeEventListener("visibilitychange", onVisibility);
      reload.current = async () => {};
    };
  }, [shipmentId]);

  const paid = Boolean(shippingPaidAt) || result?.payment.status === "PAID";
  const closed = result != null && result.payment.status !== "PENDING";
  const deadline =
    result?.reservationExpiresAt ?? result?.payment.expiresAt ?? quoteExpiresAt;
  const chargeValid = result != null && futureDate(deadline, now);
  const amount = Number(shippingCost);
  const canGenerate =
    (known || canResumeIntent) &&
    !paid &&
    !closed &&
    !uncertain &&
    shipmentStatus === "PENDING" &&
    Number.isFinite(amount) &&
    amount > 0 &&
    (result ? chargeValid : futureDate(quoteExpiresAt, now));
  const showQr =
    !paid &&
    !closed &&
    shipmentStatus === "PENDING" &&
    chargeValid &&
    result?.pix != null;

  async function createPix(event: FormEvent) {
    event.preventDefault();
    const digits = cpf.replace(/\D/g, "");
    if (
      !mounted.current ||
      !latest.current.isCurrentSession() ||
      mutation.current ||
      checking ||
      !canGenerate ||
      digits.length !== 11
    )
      return;
    mutation.current = true;
    revision.current++;
    latest.current.onBusyChange(true);
    setBusy(true);
    setReadError("");
    setPostError("");
    const valid = () =>
      mounted.current &&
      latest.current.shipmentId === shipmentId &&
      latest.current.isCurrentSession();
    try {
      const resolved = await authorized<PixResult>(
        `/shipments/${shipmentId}/payments/pix`,
        { method: "POST", body: JSON.stringify({ cpf: digits }) },
      );
      if (!valid()) return;
      payment.current = resolved;
      setResult(resolved);
      setKnown(true);
      setCanResumeIntent(false);
      setUncertain(false);
      setCpf("");
      setCopied("");
      latest.current.onResolved(resolved);
    } catch (error) {
      if (!valid()) return;
      setUncertain(true);
      setPostError(
        errorMessage(error) +
          " Atualize o pagamento para consultar esta cobrança antes de tentar novamente.",
      );
    } finally {
      mutation.current = false;
      if (valid()) {
        setBusy(false);
        latest.current.onBusyChange(false);
      }
    }
  }

  async function copyPix() {
    if (!showQr || !result?.pix) return;
    try {
      await navigator.clipboard.writeText(result.pix.payload);
      if (
        mounted.current &&
        latest.current.shipmentId === shipmentId &&
        latest.current.isCurrentSession()
      )
        setCopied("Código Pix copiado.");
    } catch {
      if (
        mounted.current &&
        latest.current.shipmentId === shipmentId &&
        latest.current.isCurrentSession()
      )
        setCopied("Selecione e copie o código abaixo.");
    }
  }

  return (
    <section className="checkout" aria-label="Pagamento do frete">
      <div className="cart-total">
        <span>Frete</span>
        <strong>
          {result
            ? money(result.payment.amount)
            : shippingCost
              ? money(shippingCost)
              : "Selecione uma cotação"}
        </strong>
      </div>
      {paid ? (
        <p className="payment-success" role="status">
          Frete pago confirmado. Acompanhe a preparação do seu envio.
        </p>
      ) : closed ? (
        <p role="status">
          {terminalLabels[result.payment.status] ??
            "Consulte a situação do pagamento do frete."}
        </p>
      ) : (
        <>
          {result?.payment.provider === "asaas:sandbox" && (
            <p className="sandbox-note">
              Ambiente de testes: este Pix é do sandbox Asaas.
            </p>
          )}
          {deadline && (
            <p className="muted">
              Prazo de pagamento: {new Date(deadline).toLocaleString("pt-BR")}.
            </p>
          )}
          {result && !chargeValid && (
            <p className="error">
              O prazo exibido terminou. Atualize o pagamento para conferir a
              situação do frete.
            </p>
          )}
          {showQr && result.pix ? (
            <div className="pix-panel">
              <h3>Pague o frete com Pix</h3>
              <img
                className="pix-qr"
                src={`data:image/png;base64,${result.pix.encodedImage}`}
                alt="QR Code Pix do frete"
              />
              <label>
                Código Pix do frete copia e cola
                <textarea
                  readOnly
                  value={result.pix.payload}
                  onFocus={(event) => event.target.select()}
                />
              </label>
              <button className="primary" onClick={() => void copyPix()}>
                Copiar código Pix do frete
              </button>
              {copied && <p role="status">{copied}</p>}
              <p className="muted">
                A confirmação será consultada automaticamente enquanto esta
                janela estiver aberta.
              </p>
            </div>
          ) : shipmentStatus === "PENDING" ? (
            <form onSubmit={(event) => void createPix(event)}>
              {result && chargeValid && (
                <p>
                  A cobrança está em processamento. Atualize o pagamento ou
                  retome o Pix deste mesmo envio.
                </p>
              )}
              {!result && known && !canGenerate && !uncertain && (
                <p>Selecione uma cotação válida para gerar o Pix do frete.</p>
              )}
              <label>
                CPF do pagador do frete
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
                  disabled={busy || !canGenerate}
                />
              </label>
              <p className="muted">
                O CPF será validado pela API para emitir a cobrança. O pagamento
                do frete é separado das cartas.
              </p>
              <button
                className="primary"
                disabled={
                  busy ||
                  checking ||
                  !canGenerate ||
                  cpf.replace(/\D/g, "").length !== 11
                }
              >
                {busy
                  ? "Gerando Pix do frete…"
                  : canResumeIntent
                    ? "Retomar Pix deste envio"
                    : result
                      ? "Retomar Pix do frete"
                      : "Gerar Pix do frete"}
              </button>
            </form>
          ) : (
            <p>
              Este envio não está disponível para gerar uma cobrança de frete.
            </p>
          )}
        </>
      )}
      {postError && (
        <p className="error" role="alert">
          {postError}
        </p>
      )}
      {readError && (
        <p className="error" role="alert">
          {readError}
        </p>
      )}
      <button
        className="checkout-back"
        disabled={busy || checking}
        onClick={() => void reload.current(true)}
      >
        {checking ? "Consultando frete…" : "Atualizar pagamento do frete"}
      </button>
    </section>
  );
}

export function FreightPayment(props: FreightPaymentProps) {
  return <FreightPaymentContent key={props.shipmentId} {...props} />;
}
