import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { authorized } from "./session";

export interface AddressInput {
  label: string | null;
  recipientName: string;
  zipCode: string;
  street: string;
  number: string;
  complement: string | null;
  neighborhood: string;
  city: string;
  state: string;
  isDefault?: boolean;
}
export interface Address extends AddressInput {
  id: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

const states = [
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
];
const initial = {
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
const zip = (value: string) => {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  return digits.length > 5
    ? `${digits.slice(0, 5)}-${digits.slice(5)}`
    : digits;
};

export function AddressPicker({
  value,
  onChange,
  disabled,
  isCurrentSession,
  onBusyChange,
}: {
  value: string;
  onChange: (id: string) => void;
  disabled: boolean;
  isCurrentSession: () => boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [form, setForm] = useState(initial);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reviewRequired, setReviewRequired] = useState(false);
  const [notice, setNotice] = useState("");
  const alive = useRef(true);
  const mutation = useRef(false);
  const revision = useRef(0);
  const readController = useRef<AbortController | null>(null);
  const selectedId = useRef(value);
  const hasChosen = useRef(Boolean(value));
  const props = useRef({ onChange, isCurrentSession, onBusyChange });
  useLayoutEffect(() => {
    props.current = { onChange, isCurrentSession, onBusyChange };
    selectedId.current = value;
  }, [value, onChange, isCurrentSession, onBusyChange]);
  const prefix = useId();
  const selected = addresses.find((address) => address.id === value);
  const blocked = disabled || busy;

  function current() {
    return alive.current && props.current.isCurrentSession();
  }

  async function load() {
    if (!current() || mutation.current) return;
    readController.current?.abort();
    const controller = new AbortController();
    readController.current = controller;
    const started = ++revision.current;
    try {
      const result = await authorized<Address[]>("/addresses", {
        signal: controller.signal,
      });
      if (
        !current() ||
        controller.signal.aborted ||
        started !== revision.current
      )
        return;
      setAddresses(result);
      setReviewRequired(false);
      setNotice("Confira os endereços antes de solicitar o envio.");
      if (!selectedId.current && !hasChosen.current) {
        const preferred = result.find((address) => address.isDefault);
        if (preferred) {
          hasChosen.current = true;
          selectedId.current = preferred.id;
          props.current.onChange(preferred.id);
        }
      }
    } catch (err) {
      if (
        !current() ||
        controller.signal.aborted ||
        started !== revision.current
      )
        return;
      setError(
        err instanceof Error
          ? err.message
          : "Não foi possível consultar os endereços.",
      );
    } finally {
      if (
        current() &&
        !controller.signal.aborted &&
        started === revision.current
      )
        setLoading(false);
    }
  }

  function stop() {
    alive.current = false;
    revision.current++;
    readController.current?.abort();
  }

  useEffect(() => {
    alive.current = true;
    let active = true;
    // Wait for setup to settle so StrictMode's discarded mount sends no read.
    void Promise.resolve().then(() => {
      if (active) return load();
    });
    return () => {
      active = false;
      stop();
    };
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (blocked || mutation.current || reviewRequired || !current()) return;
    mutation.current = true;
    revision.current++;
    readController.current?.abort();
    setLoading(false);
    setBusy(true);
    setError("");
    setNotice("");
    props.current.onBusyChange(true);
    try {
      if (!current()) return;
      const input: AddressInput = {
        label: form.label.trim() || null,
        recipientName: form.recipientName.trim(),
        zipCode: form.zipCode.replace(/\D/g, ""),
        street: form.street.trim(),
        number: form.number.trim(),
        complement: form.complement.trim() || null,
        neighborhood: form.neighborhood.trim(),
        city: form.city.trim(),
        state: form.state.trim().toUpperCase(),
        isDefault: form.isDefault,
      };
      const saved = await authorized<Address>("/addresses", {
        method: "POST",
        body: JSON.stringify(input),
      });
      if (!current()) return;
      setAddresses((existing) => [
        ...existing.map((address) =>
          saved.isDefault ? { ...address, isDefault: false } : address,
        ),
        saved,
      ]);
      selectedId.current = saved.id;
      hasChosen.current = true;
      props.current.onChange(saved.id);
      setForm(initial);
      setShowForm(false);
      setNotice("Endereço cadastrado e selecionado.");
    } catch (err) {
      if (!current()) return;
      const status = (err as { status?: number } | null)?.status;
      if (status === undefined || status >= 500) {
        setReviewRequired(true);
        setError(
          "Não foi possível confirmar o cadastro. Atualize os endereços e confira se ele já foi salvo antes de tentar novamente.",
        );
      } else {
        setError(
          err instanceof Error
            ? err.message
            : "Não foi possível cadastrar o endereço.",
        );
      }
    } finally {
      mutation.current = false;
      if (current()) {
        setBusy(false);
        props.current.onBusyChange(false);
      }
    }
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

  return (
    <section className="shipping-addresses" aria-label="Endereços de entrega">
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && (
        <p className="hint" role="status">
          {notice}
        </p>
      )}
      <label htmlFor={`${prefix}-select`}>Endereço de entrega</label>
      <select
        id={`${prefix}-select`}
        value={value}
        disabled={blocked || loading}
        onChange={(event) => {
          if (!current() || blocked) return;
          hasChosen.current = true;
          selectedId.current = event.target.value;
          props.current.onChange(event.target.value);
        }}
      >
        <option value="">
          {loading ? "Carregando endereços…" : "Selecione um endereço"}
        </option>
        {addresses.map((address) => (
          <option key={address.id} value={address.id}>
            {address.label || address.recipientName} — {address.street},{" "}
            {address.number} — {address.city}/{address.state}
            {address.isDefault ? " (Principal)" : ""}
          </option>
        ))}
      </select>
      {selected && (
        <address className="address-preview">
          <strong>{selected.recipientName}</strong>
          <br />
          {selected.street}, {selected.number}
          {selected.complement ? `, ${selected.complement}` : ""}
          <br />
          {selected.neighborhood} — {selected.city}/{selected.state}
          <br />
          CEP {zip(selected.zipCode)}
        </address>
      )}
      {!loading && addresses.length === 0 && (
        <p>Cadastre um endereço para receber suas compras acumuladas.</p>
      )}
      <div className="button-row">
        <button
          type="button"
          className="outline"
          disabled={blocked || loading}
          onClick={() => {
            setLoading(true);
            setError("");
            void load();
          }}
        >
          Atualizar endereços
        </button>
        {!showForm && (
          <button
            type="button"
            className="outline"
            disabled={blocked || loading}
            onClick={() => {
              setShowForm(true);
              setError("");
            }}
          >
            Cadastrar endereço
          </button>
        )}
      </div>
      {showForm && (
        <form className="address-form" onSubmit={save}>
          <h3>Novo endereço</h3>
          <fieldset disabled={blocked}>
            <div className="form-grid">
              {fields.map(([key, label, maxLength, required, autoComplete]) => (
                <label key={key} htmlFor={`${prefix}-${key}`}>
                  {label}
                  <input
                    id={`${prefix}-${key}`}
                    value={form[key]}
                    maxLength={maxLength}
                    required={required}
                    autoComplete={autoComplete}
                    inputMode={key === "zipCode" ? "numeric" : undefined}
                    pattern={
                      key === "zipCode" ? "[0-9]{5}-?[0-9]{3}" : undefined
                    }
                    onChange={(event) =>
                      setForm((previous) => ({
                        ...previous,
                        [key]:
                          key === "zipCode"
                            ? zip(event.target.value)
                            : event.target.value,
                      }))
                    }
                  />
                </label>
              ))}
              <label htmlFor={`${prefix}-state`}>
                Estado
                <select
                  id={`${prefix}-state`}
                  required
                  autoComplete="address-level1"
                  value={form.state}
                  onChange={(event) =>
                    setForm((previous) => ({
                      ...previous,
                      state: event.target.value,
                    }))
                  }
                >
                  <option value="">Selecione a UF</option>
                  {states.map((state) => (
                    <option key={state} value={state}>
                      {state}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={form.isDefault}
                onChange={(event) =>
                  setForm((previous) => ({
                    ...previous,
                    isDefault: event.target.checked,
                  }))
                }
              />{" "}
              Usar como endereço principal
            </label>
          </fieldset>
          <div className="button-row">
            <button
              type="submit"
              className="primary"
              disabled={blocked || reviewRequired}
            >
              {busy ? "Salvando endereço…" : "Salvar endereço"}
            </button>
            <button
              type="button"
              className="outline"
              disabled={blocked}
              onClick={() => setShowForm(false)}
            >
              Cancelar cadastro
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
