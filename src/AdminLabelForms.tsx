import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { FormEvent, RefObject } from "react";
import { money } from "./api";
import {
  validateCreateLabel,
  validateExpectedCost,
  validateRecoveryId,
} from "./admin-shipments";
import type { CreateLabelDraft, CreateLabelInput } from "./admin-shipments";

type SessionProps = { busy: boolean; isCurrentSession: () => boolean };

/** These forms never issue requests or persist recipient information. */
function useSubmission<T>(
  props: SessionProps & { onSubmit: (input: T) => Promise<void> },
  failureMessage: string,
) {
  const latest = useRef(props);
  const alive = useRef(true);
  const mutation = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  useLayoutEffect(() => {
    latest.current = props;
  });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  function editable() {
    return (
      alive.current &&
      latest.current.isCurrentSession() &&
      !latest.current.busy &&
      !mutation.current
    );
  }
  async function submit(input: T) {
    if (!editable()) return false;
    mutation.current = true;
    setSubmitting(true);
    setError("");
    try {
      await latest.current.onSubmit(input);
    } catch {
      // A provider error can include documents, phone numbers or credentials.
      if (alive.current && latest.current.isCurrentSession())
        setError(failureMessage);
    } finally {
      mutation.current = false;
      if (alive.current) setSubmitting(false);
    }
    return true;
  }
  return {
    blocked: props.busy || submitting,
    editable,
    submit,
    error,
    clearError: () => setError(""),
    mounted: () => alive.current,
  };
}

function useClearOnUnmount(form: RefObject<HTMLFormElement | null>) {
  useEffect(() => {
    const element = form.current;
    return () => {
      element?.reset();
    };
  }, [form]);
}

const createFields = [
  ["recipientDocument", "CPF do destinatário", 24],
  ["recipientPhone", "Telefone do destinatário com DDD", 24],
  ["invoiceKey", "Chave da nota fiscal", 44],
] as const;

export function CreateLabelForm(
  props: SessionProps & {
    production: boolean;
    onSubmit: (input: CreateLabelInput) => Promise<void>;
  },
) {
  const form = useRef<HTMLFormElement>(null);
  const prefix = useId();
  const [errors, setErrors] = useState<
    Partial<Record<keyof CreateLabelDraft, string>>
  >({});
  const [reviewed, setReviewed] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const action = useSubmission(
    props,
    "Não foi possível concluir a criação. Consulte a etiqueta antes de tentar novamente.",
  );
  useClearOnUnmount(form);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action.editable() || !form.current) return;
    const values = new FormData(form.current);
    const draft: CreateLabelDraft = {
      recipientDocument: String(values.get("recipientDocument") ?? ""),
      recipientPhone: String(values.get("recipientPhone") ?? ""),
      invoiceKey: String(values.get("invoiceKey") ?? ""),
    };
    const validated = validateCreateLabel(draft);
    if (props.production && !draft.invoiceKey.trim())
      validated.errors.invoiceKey =
        "Informe a chave da nota fiscal de 44 dígitos para produção.";
    setErrors(validated.errors);
    setReviewError(
      reviewed ? "" : "Confirme a revisão dos dados e da embalagem.",
    );
    if (
      !reviewed ||
      !validated.input ||
      Object.values(validated.errors).some(Boolean)
    )
      return;
    const attempted = await action.submit(validated.input);
    if (attempted && action.mounted()) {
      form.current?.reset();
      setReviewed(false);
      setErrors({});
      setReviewError("");
    }
  }

  return (
    <form
      ref={form}
      className="address-form"
      noValidate
      autoComplete="off"
      onSubmit={(event) => void submit(event)}
      aria-label="Criar etiqueta"
    >
      <h3>Dados para criar a etiqueta</h3>
      <p className="hint">
        Informe os dados do destinatário. Eles serão usados apenas nesta
        solicitação.
      </p>
      {props.production && (
        <p className="hint">Produção: a chave da nota fiscal é obrigatória.</p>
      )}
      <fieldset disabled={action.blocked}>
        <div className="form-grid">
          {createFields.map(([key, label, maxLength]) => (
            <div key={key}>
              <label htmlFor={`${prefix}-${key}`}>
                {label}
                {key === "invoiceKey" && !props.production
                  ? " (opcional no sandbox)"
                  : ""}
                <input
                  id={`${prefix}-${key}`}
                  name={key}
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  inputMode={key === "recipientPhone" ? "tel" : "numeric"}
                  maxLength={maxLength}
                  required={key !== "invoiceKey" || props.production}
                  aria-invalid={Boolean(errors[key])}
                  aria-describedby={
                    errors[key] ? `${prefix}-${key}-error` : undefined
                  }
                  onChange={() => {
                    if (!action.editable()) return;
                    setErrors((previous) => ({
                      ...previous,
                      [key]: undefined,
                    }));
                    setReviewed(false);
                    setReviewError("");
                    action.clearError();
                  }}
                />
              </label>
              {errors[key] && (
                <small className="field-error" id={`${prefix}-${key}-error`}>
                  {errors[key]}
                </small>
              )}
            </div>
          ))}
        </div>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={reviewed}
            aria-invalid={Boolean(reviewError)}
            aria-describedby={
              reviewError ? `${prefix}-review-error` : undefined
            }
            onChange={(event) => {
              if (!action.editable()) return;
              setReviewed(event.target.checked);
              setReviewError("");
            }}
          />
          Revisei os dados do destinatário e a embalagem
        </label>
        {reviewError && (
          <small className="field-error" id={`${prefix}-review-error`}>
            {reviewError}
          </small>
        )}
      </fieldset>
      {action.error && (
        <p role="alert" className="notice error">
          {action.error}
        </p>
      )}
      <button type="submit" className="primary" disabled={action.blocked}>
        {action.blocked ? "Criando etiqueta…" : "Criar etiqueta"}
      </button>
    </form>
  );
}

export function RecoveryLabelForm(
  props: SessionProps & {
    onSubmit: (remoteId: string) => Promise<void>;
  },
) {
  const form = useRef<HTMLFormElement>(null);
  const prefix = useId();
  const [error, setError] = useState("");
  const action = useSubmission(
    props,
    "Não foi possível recuperar a etiqueta. Consulte o envio antes de tentar novamente.",
  );
  useClearOnUnmount(form);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action.editable() || !form.current) return;
    const id = validateRecoveryId(
      String(new FormData(form.current).get("remoteId") ?? ""),
    );
    setError(id ? "" : "Informe o UUID da etiqueta existente no Melhor Envio.");
    if (!id) return;
    const attempted = await action.submit(id);
    if (attempted && action.mounted()) form.current?.reset();
  }
  return (
    <form
      ref={form}
      className="address-form"
      noValidate
      autoComplete="off"
      onSubmit={(event) => void submit(event)}
      aria-label="Recuperar etiqueta"
    >
      <h3>Recuperar etiqueta existente</h3>
      <p className="hint" id={`${prefix}-help`}>
        Use o ID real da etiqueta criada no Melhor Envio para este envio. Não
        invente um código nem crie outra etiqueta.
      </p>
      <fieldset disabled={action.blocked}>
        <label htmlFor={`${prefix}-remote`}>
          ID da etiqueta no Melhor Envio
          <input
            id={`${prefix}-remote`}
            name="remoteId"
            autoComplete="off"
            spellCheck={false}
            maxLength={50}
            required
            aria-invalid={Boolean(error)}
            aria-describedby={`${prefix}-help${error ? ` ${prefix}-error` : ""}`}
            onChange={() => {
              if (action.editable()) {
                setError("");
                action.clearError();
              }
            }}
          />
        </label>
        {error && (
          <small className="field-error" id={`${prefix}-error`}>
            {error}
          </small>
        )}
      </fieldset>
      {action.error && (
        <p role="alert" className="notice error">
          {action.error}
        </p>
      )}
      <button type="submit" className="outline" disabled={action.blocked}>
        {action.blocked ? "Recuperando etiqueta…" : "Recuperar etiqueta"}
      </button>
    </form>
  );
}

type CheckoutProps = SessionProps & {
  cost: string;
  provider: string;
  onSubmit: (expectedCost: string) => Promise<void>;
};

export function LabelCheckoutForm(props: CheckoutProps) {
  const action = useSubmission(
    props,
    "Não foi possível confirmar a compra. Consulte a etiqueta antes de tentar novamente.",
  );
  // Reset the approval on every environment or amount change, retaining the outer mutation lock.
  return (
    <CheckoutApproval
      key={`${props.provider}:${props.cost}`}
      {...props}
      action={action}
    />
  );
}

function CheckoutApproval({
  cost,
  provider,
  action,
}: CheckoutProps & {
  action: ReturnType<typeof useSubmission<string>>;
}) {
  const prefix = useId();
  const alive = useRef(true);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState("");
  const valid = validateExpectedCost(cost);
  const production = provider === "melhorenvio:production";
  const supported = production || provider === "melhorenvio:sandbox";
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action.editable() || !supported || !valid) return;
    setError(accepted ? "" : "Autorize o valor antes de comprar a etiqueta.");
    if (!accepted) return;
    await action.submit(cost);
    if (alive.current) setAccepted(false);
  }
  return (
    <form
      className="address-form"
      noValidate
      onSubmit={(event) => void submit(event)}
      aria-label="Comprar etiqueta"
    >
      <h3>Compra da etiqueta</h3>
      {supported ? (
        <p className="notice">
          {production
            ? "Produção: esta compra utiliza saldo real da carteira do Melhor Envio."
            : "Sandbox: etiqueta de teste, sem validade para postagem."}
        </p>
      ) : (
        <p role="alert" className="notice error">
          Ambiente da etiqueta não reconhecido. Atualize os dados antes de
          comprar.
        </p>
      )}
      {valid ? (
        <p>
          Valor da etiqueta: <strong>{money(cost)}</strong>
        </p>
      ) : (
        <p role="alert" className="notice error">
          Valor da etiqueta inválido. Atualize os dados antes de comprar.
        </p>
      )}
      <fieldset disabled={action.blocked || !valid || !supported}>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={accepted}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${prefix}-error` : undefined}
            onChange={(event) => {
              if (!action.editable()) return;
              setAccepted(event.target.checked);
              setError("");
              action.clearError();
            }}
          />
          Autorizo a compra desta etiqueta por{" "}
          {valid ? money(cost) : "valor a confirmar"}
          {production ? " com saldo real" : " no sandbox"}
        </label>
        {error && (
          <small className="field-error" id={`${prefix}-error`}>
            {error}
          </small>
        )}
      </fieldset>
      {action.error && (
        <p role="alert" className="notice error">
          {action.error}
        </p>
      )}
      <button
        type="submit"
        className="primary"
        disabled={action.blocked || !valid || !supported}
      >
        {action.blocked ? "Comprando etiqueta…" : "Comprar etiqueta"}
      </button>
    </form>
  );
}
