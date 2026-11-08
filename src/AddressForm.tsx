import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { Address, AddressInput } from "./ShippingAddresses";
import {
  addressStates,
  addressToDraft,
  emptyAddressDraft,
  validateAddressDraft,
} from "./addresses";
import type { AddressDraft, AddressErrors } from "./addresses";

export interface AddressFormProps {
  initial?: Address;
  busy: boolean;
  isCurrentSession: () => boolean;
  onSubmit: (input: AddressInput) => Promise<void>;
  onCancel: () => void;
}
const fields = [
  ["label", "Identificação (opcional)", 60, false, "off"],
  ["recipientName", "Nome do destinatário", 120, true, "name"],
  ["zipCode", "CEP", 9, true, "postal-code"],
  ["street", "Rua ou avenida", 200, true, "address-line1"],
  ["number", "Número", 20, true, "off"],
  ["complement", "Complemento (opcional)", 120, false, "address-line2"],
  ["neighborhood", "Bairro", 120, true, "off"],
  ["city", "Cidade", 120, true, "address-level2"],
] as const;

export function AddressForm(props: AddressFormProps) {
  // Keyed inner state resets for another address/version without carrying private fields.
  return (
    <AddressFormContent
      key={`${props.initial?.id ?? "new"}:${props.initial?.updatedAt ?? ""}`}
      {...props}
    />
  );
}
function AddressFormContent(props: AddressFormProps) {
  const [draft, setDraft] = useState(() =>
    props.initial ? addressToDraft(props.initial) : emptyAddressDraft(),
  );
  const [errors, setErrors] = useState<AddressErrors>({});
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const latest = useRef(props);
  const alive = useRef(true);
  const lock = useRef(false);
  const element = useRef<HTMLFormElement>(null);
  const prefix = useId();
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
  function change(key: keyof AddressDraft, value: string | boolean) {
    if (!current() || latest.current.busy || lock.current) return;
    setDraft((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => ({ ...previous, [key]: undefined }));
    setError("");
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current() || latest.current.busy || lock.current) return;
    const validated = validateAddressDraft(draft);
    setErrors(validated.errors);
    if (!validated.input) return;
    if (props.initial?.isDefault && !validated.input.isDefault) return;
    lock.current = true;
    setSubmitting(true);
    setError("");
    try {
      await latest.current.onSubmit(validated.input);
    } catch {
      if (current())
        setError(
          "Não foi possível confirmar o endereço. Consulte a lista antes de tentar novamente.",
        );
    } finally {
      lock.current = false;
      if (current()) setSubmitting(false);
    }
  }
  return (
    <form
      ref={element}
      className="address-form"
      noValidate
      onSubmit={(event) => void submit(event)}
      aria-label={props.initial ? "Editar endereço" : "Novo endereço"}
    >
      <h3>{props.initial ? "Editar endereço" : "Novo endereço"}</h3>
      <fieldset disabled={blocked}>
        <div className="form-grid">
          {fields.map(([key, label, maxLength, required, autoComplete]) => (
            <div key={key}>
              <label htmlFor={`${prefix}-${key}`}>
                {label}
                <input
                  id={`${prefix}-${key}`}
                  name={key}
                  value={draft[key]}
                  maxLength={maxLength}
                  required={required}
                  autoComplete={autoComplete}
                  inputMode={key === "zipCode" ? "numeric" : undefined}
                  aria-invalid={Boolean(errors[key])}
                  aria-describedby={
                    errors[key] ? `${prefix}-${key}-error` : undefined
                  }
                  onChange={(event) => change(key, event.target.value)}
                />
              </label>
              {errors[key] && (
                <small className="field-error" id={`${prefix}-${key}-error`}>
                  {errors[key]}
                </small>
              )}
            </div>
          ))}
          <div>
            <label htmlFor={`${prefix}-state`}>
              Estado
              <select
                id={`${prefix}-state`}
                name="state"
                value={draft.state}
                required
                autoComplete="address-level1"
                aria-invalid={Boolean(errors.state)}
                aria-describedby={
                  errors.state ? `${prefix}-state-error` : undefined
                }
                onChange={(event) => change("state", event.target.value)}
              >
                <option value="">Selecione a UF</option>
                {addressStates.map((state) => (
                  <option value={state} key={state}>
                    {state}
                  </option>
                ))}
              </select>
            </label>
            {errors.state && (
              <small className="field-error" id={`${prefix}-state-error`}>
                {errors.state}
              </small>
            )}
          </div>
        </div>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={draft.isDefault}
            disabled={Boolean(props.initial?.isDefault)}
            onChange={(event) => change("isDefault", event.target.checked)}
          />
          Usar como endereço principal
        </label>
        {props.initial?.isDefault && (
          <p className="hint">
            Este é o endereço principal. Para mudar, escolha outro endereço como
            principal.
          </p>
        )}
      </fieldset>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="button-row">
        <button className="primary" type="submit" disabled={blocked}>
          {blocked ? "Salvando endereço…" : "Salvar endereço"}
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
          Cancelar {props.initial ? "edição" : "cadastro"}
        </button>
      </div>
    </form>
  );
}
