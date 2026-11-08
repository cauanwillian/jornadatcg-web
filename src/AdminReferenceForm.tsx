import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { referenceLabels, validateReference } from "./admin-references";
import type {
  ReferenceDraft,
  ReferenceErrors,
  ReferenceInput,
  ReferenceKind,
} from "./admin-references";

export interface AdminReferenceFormProps {
  kind: ReferenceKind;
  busy: boolean;
  isCurrentSession: () => boolean;
  onSubmit: (input: ReferenceInput) => Promise<void>;
  onCancel: () => void;
}
export function AdminReferenceForm(props: AdminReferenceFormProps) {
  return <ReferenceFormContent key={props.kind} {...props} />;
}
function ReferenceFormContent(props: AdminReferenceFormProps) {
  const [draft, setDraft] = useState<ReferenceDraft>({
    name: "",
    identifier: "",
    description: "",
  });
  const [errors, setErrors] = useState<ReferenceErrors>({});
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const latest = useRef(props);
  const alive = useRef(true);
  const lock = useRef(false);
  const element = useRef<HTMLFormElement>(null);
  const prefix = useId();
  const labels = referenceLabels(props.kind);
  useLayoutEffect(() => {
    latest.current = props;
  });
  useEffect(() => {
    alive.current = true;
    const form = element.current;
    form?.querySelector("input")?.focus();
    return () => {
      alive.current = false;
      form?.reset();
    };
  }, []);
  const current = () => alive.current && latest.current.isCurrentSession();
  const blocked = props.busy || submitting;
  function change(key: keyof ReferenceDraft, value: string) {
    if (!current() || latest.current.busy || lock.current) return;
    setDraft((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => ({ ...previous, [key]: undefined }));
    setError("");
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current() || latest.current.busy || lock.current) return;
    const validated = validateReference(props.kind, draft);
    setErrors(validated.errors);
    if (!validated.input) {
      const first = Object.keys(validated.errors)[0];
      element.current
        ?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
          `[name="${first}"]`,
        )
        ?.focus();
      return;
    }
    lock.current = true;
    setSubmitting(true);
    setError("");
    try {
      await latest.current.onSubmit(validated.input);
    } catch {
      if (current())
        setError(
          "Não foi possível confirmar o cadastro. Atualize a lista e confira se ele já existe antes de tentar novamente.",
        );
    } finally {
      lock.current = false;
      if (current()) setSubmitting(false);
    }
  }
  const described = (field: keyof ReferenceDraft) =>
    errors[field] ? `${prefix}-${field}-error` : undefined;
  return (
    <form
      ref={element}
      className="address-form reference-form"
      noValidate
      autoComplete="off"
      aria-label={labels.heading}
      onSubmit={(event) => void submit(event)}
    >
      <h3>{labels.heading}</h3>
      <fieldset disabled={blocked}>
        <label htmlFor={`${prefix}-name`}>
          Nome
          <input
            id={`${prefix}-name`}
            name="name"
            value={draft.name}
            maxLength={120}
            required
            autoComplete="off"
            aria-invalid={Boolean(errors.name)}
            aria-describedby={described("name")}
            onChange={(event) => change("name", event.target.value)}
          />
        </label>
        {errors.name && (
          <small className="field-error" id={`${prefix}-name-error`}>
            {errors.name}
          </small>
        )}
        <label htmlFor={`${prefix}-identifier`}>
          {labels.identifier}
          <input
            id={`${prefix}-identifier`}
            name="identifier"
            value={draft.identifier}
            maxLength={props.kind === "category" ? 100 : 20}
            required
            autoComplete="off"
            spellCheck={false}
            aria-invalid={Boolean(errors.identifier)}
            aria-describedby={`${prefix}-identifier-help${errors.identifier ? ` ${prefix}-identifier-error` : ""}`}
            onChange={(event) => change("identifier", event.target.value)}
          />
        </label>
        <p className="hint" id={`${prefix}-identifier-help`}>
          Exemplo: {labels.example}.{" "}
          {props.kind === "category"
            ? "Use letras, números e hífens entre palavras. O identificador será salvo em minúsculas."
            : "Use letras, números e hífens entre palavras. O código será salvo em maiúsculas."}
        </p>
        {errors.identifier && (
          <small className="field-error" id={`${prefix}-identifier-error`}>
            {errors.identifier}
          </small>
        )}
        {props.kind !== "language" && (
          <>
            <label htmlFor={`${prefix}-description`}>
              Descrição (opcional)
              <textarea
                id={`${prefix}-description`}
                name="description"
                value={draft.description}
                maxLength={2000}
                rows={3}
                aria-invalid={Boolean(errors.description)}
                aria-describedby={described("description")}
                onChange={(event) => change("description", event.target.value)}
              />
            </label>
            {errors.description && (
              <small className="field-error" id={`${prefix}-description-error`}>
                {errors.description}
              </small>
            )}
          </>
        )}
      </fieldset>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="button-row">
        <button className="primary" type="submit" disabled={blocked}>
          {blocked ? "Salvando cadastro…" : labels.save}
        </button>
        <button
          className="outline"
          type="button"
          disabled={blocked}
          onClick={() => {
            if (current() && !lock.current && !latest.current.busy)
              latest.current.onCancel();
          }}
        >
          Cancelar cadastro
        </button>
      </div>
    </form>
  );
}
