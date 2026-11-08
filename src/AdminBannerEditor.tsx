import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";
import {
  bannerDraft,
  inspectBannerImage,
  validateBanner,
  validateBannerFile,
} from "./admin-banners";
import type { AdminBanner, BannerDraft, BannerInput } from "./admin-banners";

export function BannerImagePicker({
  disabled,
  onChange,
  isCurrentSession,
  label = "Imagem do banner",
  onValidating,
  error: externalError,
}: {
  disabled: boolean;
  onChange: (file: File | null) => void;
  isCurrentSession: () => boolean;
  label?: string;
  onValidating?: (validating: boolean) => void;
  error?: string;
}) {
  const [fileError, setFileError] = useState("");
  const [preview, setPreview] = useState("");
  const [checking, setChecking] = useState(false);
  const alive = useRef(true);
  const revision = useRef(0);
  const imageCheck = useRef<AbortController | null>(null);
  const previewUrl = useRef("");
  const latest = useRef({ disabled, onChange, isCurrentSession, onValidating });
  const prefix = useId();
  const shownError = fileError || externalError;

  useLayoutEffect(() => {
    latest.current = { disabled, onChange, isCurrentSession, onValidating };
  }, [disabled, onChange, isCurrentSession, onValidating]);

  function current() {
    return alive.current && latest.current.isCurrentSession();
  }

  function releasePreview() {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = "";
  }

  function stop() {
    alive.current = false;
    revision.current++;
    imageCheck.current?.abort();
    releasePreview();
  }

  useEffect(() => {
    alive.current = true;
    return stop;
  }, []);

  async function chooseImage(event: ChangeEvent<HTMLInputElement>) {
    if (!current() || latest.current.disabled) return;
    const selected = event.target.files?.[0] ?? null;
    const started = ++revision.current;
    imageCheck.current?.abort();
    imageCheck.current = null;
    releasePreview();
    setPreview("");
    latest.current.onChange(null);
    const invalidFile = validateBannerFile(selected);
    setFileError(invalidFile ?? "");
    if (!selected || invalidFile) {
      setChecking(false);
      latest.current.onValidating?.(false);
      return;
    }
    const controller = new AbortController();
    imageCheck.current = controller;
    setChecking(true);
    latest.current.onValidating?.(true);
    try {
      await inspectBannerImage(selected, controller.signal);
      if (
        !current() ||
        controller.signal.aborted ||
        revision.current !== started
      )
        return;
      const url = URL.createObjectURL(selected);
      previewUrl.current = url;
      setPreview(url);
      latest.current.onChange(selected);
    } catch {
      if (
        !current() ||
        controller.signal.aborted ||
        revision.current !== started
      )
        return;
      setFileError(
        "Não foi possível validar esta imagem. Escolha um arquivo PNG, JPEG ou WebP de 1600 × 500 px e até 5 MB.",
      );
    } finally {
      if (
        current() &&
        !controller.signal.aborted &&
        revision.current === started
      ) {
        imageCheck.current = null;
        setChecking(false);
        latest.current.onValidating?.(false);
      }
    }
  }

  return (
    <div>
      <label>
        {label}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={disabled}
          onChange={(event) => void chooseImage(event)}
          aria-invalid={Boolean(shownError)}
          aria-describedby={`${prefix}-help${shownError ? ` ${prefix}-error` : ""}`}
        />
      </label>
      <small className="hint" id={`${prefix}-help`}>
        Imagem de 1600 × 500 px, em PNG, JPEG ou WebP, com até 5 MB.
      </small>
      {checking && <p role="status">Verificando imagem…</p>}
      {shownError && (
        <small className="field-error" id={`${prefix}-error`}>
          {shownError}
        </small>
      )}
      {preview && (
        <img
          className="banner-file-preview"
          src={preview}
          alt="Prévia da imagem selecionada"
        />
      )}
    </div>
  );
}

export function BannerEditor({
  banner,
  busy,
  onSave,
  onCancel,
  isCurrentSession,
  preview: existingPreview,
}: {
  banner?: AdminBanner;
  busy: boolean;
  onSave: (input: BannerInput, file: File | null) => Promise<boolean>;
  onCancel: () => void;
  isCurrentSession: () => boolean;
  preview?: ReactNode;
}) {
  const [draft, setDraft] = useState(() => bannerDraft(banner));
  const [errors, setErrors] = useState<
    Partial<Record<keyof BannerDraft, string>>
  >({});
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const [checkingImage, setCheckingImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const alive = useRef(true);
  const mutation = useRef(false);
  const latest = useRef({ busy, onSave, onCancel, isCurrentSession });
  const prefix = useId();
  const creating = !banner;
  const blocked = busy || saving;

  useLayoutEffect(() => {
    latest.current = { busy, onSave, onCancel, isCurrentSession };
  }, [busy, onSave, onCancel, isCurrentSession]);

  function current() {
    return alive.current && latest.current.isCurrentSession();
  }

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  function change<K extends keyof BannerDraft>(
    field: K,
    value: BannerDraft[K],
  ) {
    if (!current() || latest.current.busy || mutation.current) return;
    setDraft((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => ({ ...previous, [field]: undefined }));
    setSaveError("");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !current() ||
      latest.current.busy ||
      mutation.current ||
      checkingImage
    )
      return;
    const validated = validateBanner(draft);
    setErrors(validated.errors);
    const invalidFile = creating ? validateBannerFile(file) : null;
    if (invalidFile) setFileError((previous) => previous || invalidFile);
    if (
      !validated.input ||
      Object.values(validated.errors).some(Boolean) ||
      invalidFile
    )
      return;

    mutation.current = true;
    setSaving(true);
    setSaveError("");
    try {
      if (!current()) return;
      await latest.current.onSave(validated.input, creating ? file : null);
    } catch {
      if (current())
        setSaveError(
          "Não foi possível salvar o banner. Confira o resultado antes de tentar novamente.",
        );
    } finally {
      mutation.current = false;
      if (current()) setSaving(false);
    }
  }

  function validity(field: keyof BannerDraft) {
    return {
      "aria-invalid": Boolean(errors[field]),
      "aria-describedby": errors[field]
        ? `${prefix}-${field}-error`
        : undefined,
    };
  }

  function error(field: keyof BannerDraft) {
    return errors[field] ? (
      <small className="field-error" id={`${prefix}-${field}-error`}>
        {errors[field]}
      </small>
    ) : null;
  }

  return (
    <section className="admin-banner-editor">
      <h3>{creating ? "Novo banner" : "Editar banner"}</h3>
      <form noValidate onSubmit={save}>
        <fieldset className="shipping-fieldset" disabled={blocked}>
          <div>
            <label>
              Título do banner
              <input
                value={draft.title}
                maxLength={120}
                onChange={(event) => change("title", event.target.value)}
                {...validity("title")}
              />
            </label>
            {error("title")}
          </div>
          <div className="form-grid">
            <div>
              <label>
                Destino do banner (opcional)
                <input
                  value={draft.link}
                  placeholder="/#catalogo"
                  autoComplete="off"
                  onChange={(event) => change("link", event.target.value)}
                  {...validity("link")}
                />
              </label>
              <small className="hint">Use um caminho do site, como /#catalogo.</small>
              {error("link")}
            </div>
            <div>
              <label>
                Ordem de exibição
                <input
                  value={draft.sortOrder}
                  inputMode="numeric"
                  autoComplete="off"
                  onChange={(event) => change("sortOrder", event.target.value)}
                  {...validity("sortOrder")}
                />
              </label>
              <small className="hint">De 0 a 999999. Os menores valores aparecem primeiro.</small>
              {error("sortOrder")}
            </div>
          </div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={draft.active}
              onChange={(event) => change("active", event.target.checked)}
            />
            Banner ativo
          </label>
          {creating ? (
            <BannerImagePicker
              disabled={blocked}
              isCurrentSession={isCurrentSession}
              error={fileError}
              onValidating={setCheckingImage}
              onChange={(selected) => {
                if (!current() || latest.current.busy || mutation.current) return;
                setFile(selected);
                setFileError("");
                setSaveError("");
              }}
            />
          ) : (
            <div>
              {existingPreview ?? (
                <p className="hint">A prévia da imagem está disponível no painel de banners.</p>
              )}
              <p className="hint">
                Para trocar a imagem, use a ação Trocar imagem na lista de banners.
              </p>
            </div>
          )}
          {saveError && (
            <p className="error" role="alert">
              {saveError}
            </p>
          )}
          {(Object.values(errors).some(Boolean) || fileError) && (
            <p className="error" role="alert">
              Confira os campos indicados antes de salvar.
            </p>
          )}
          <div className="button-row">
            <button
              className="outline"
              type="button"
              onClick={() => {
                if (!current() || latest.current.busy || mutation.current) return;
                latest.current.onCancel();
              }}
            >
              Cancelar edição
            </button>
            <button className="primary" type="submit" disabled={checkingImage}>
              {saving
                ? "Salvando…"
                : creating
                  ? "Cadastrar banner"
                  : "Salvar alterações"}
            </button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}
