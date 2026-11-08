import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { authorized, authorizedBlob } from "./session";
import { BannerEditor, BannerImagePicker } from "./AdminBannerEditor";
import { changedBannerFields } from "./admin-banners";
import type { AdminBanner, BannerInput } from "./admin-banners";

const status = (error: unknown) =>
  error && typeof error === "object" && "status" in error
    ? Number(error.status)
    : undefined;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function errorText(error: unknown) {
  switch (status(error)) {
    case 400:
      return "Confira os dados e use uma imagem estática PNG, JPEG ou WebP de 1600 × 500 pixels.";
    case 401:
      return "Sua sessão expirou. Entre novamente.";
    case 403:
      return "Acesso restrito a administradores.";
    case 404:
      return "Banner não encontrado. Atualize a lista.";
    case 413:
      return "A imagem deve ter até 5 MB.";
    default:
      return "Não foi possível confirmar a operação. Atualize os banners para conferir o resultado antes de tentar novamente.";
  }
}
function bannerRecord(value: unknown): value is AdminBanner {
  if (!value || typeof value !== "object") return false;
  const row = value as AdminBanner;
  return (
    typeof row.id === "string" &&
    uuid.test(row.id) &&
    typeof row.title === "string" &&
    !!row.title.trim() &&
    row.title.length <= 120 &&
    typeof row.active === "boolean" &&
    Number.isInteger(row.sortOrder) &&
    row.sortOrder >= 0 &&
    row.sortOrder <= 999999 &&
    (row.link === null || typeof row.link === "string") &&
    typeof row.updatedAt === "string" &&
    typeof row.createdAt === "string"
  );
}
function storedCreation(key: string) {
  try {
    const title = sessionStorage.getItem(key);
    if (title !== null && (!title.trim() || title.length > 120))
      throw new Error();
    return { title, blocked: false };
  } catch {
    return { title: null, blocked: true };
  }
}

function BannerPreview({
  banner,
  isCurrentSession,
  onForbidden,
}: {
  banner: AdminBanner;
  isCurrentSession: () => boolean;
  onForbidden: () => void;
}) {
  const stamp = `${banner.id}:${banner.updatedAt}`;
  const [preview, setPreview] = useState<{ stamp: string; url: string } | null>(
    null,
  );
  const [problem, setProblem] = useState("");
  const callbacks = useRef({ isCurrentSession, onForbidden });
  useLayoutEffect(() => {
    callbacks.current = { isCurrentSession, onForbidden };
  }, [isCurrentSession, onForbidden]);
  useEffect(() => {
    let active = true;
    let localUrl: string | null = null;
    const controller = new AbortController();
    const load = async () => {
      setProblem("");
      try {
        const blob = await authorizedBlob(
          `/admin/banners/${banner.id}/image?v=${encodeURIComponent(banner.updatedAt)}`,
          { signal: controller.signal, cache: "no-store" },
        );
        if (!active || !callbacks.current.isCurrentSession()) return;
        if (!blob.size || !blob.type.startsWith("image/")) throw new Error();
        localUrl = URL.createObjectURL(blob);
        setPreview({ stamp, url: localUrl });
      } catch (caught) {
        if (active && callbacks.current.isCurrentSession()) {
          if (status(caught) === 403) callbacks.current.onForbidden();
          else setProblem("Prévia indisponível.");
        }
      }
    };
    void load();
    return () => {
      active = false;
      controller.abort();
      if (localUrl) URL.revokeObjectURL(localUrl);
    };
  }, [banner.id, banner.updatedAt, stamp]);
  return (
    <div className="admin-banner-preview">
      {preview?.stamp === stamp && !problem ? (
        <img
          loading="lazy"
          src={preview.url}
          alt={banner.title}
          onError={() => setProblem("Prévia indisponível.")}
        />
      ) : (
        <span>{problem || "Carregando prévia…"}</span>
      )}
    </div>
  );
}

export function BannerPanel({
  userId,
  isCurrentSession,
  onBusyChange,
  onChanged,
}: {
  userId: string;
  isCurrentSession: () => boolean;
  onBusyChange: (busy: boolean) => void;
  onChanged?: () => void;
}) {
  const guardKey = `jornada-admin-banner:${userId}`;
  const [stored] = useState(() => storedCreation(guardKey));
  const [pendingTitle, setPendingTitle] = useState(stored.title);
  const [storageBlocked, setStorageBlocked] = useState(stored.blocked);
  const [reviewed, setReviewed] = useState(false);
  const [rows, setRows] = useState<AdminBanner[] | null>(null);
  const [page, setPage] = useState(1);
  const [view, setView] = useState<"list" | "new" | "edit" | "replace">("list");
  const [current, setCurrent] = useState<AdminBanner | null>(null);
  const [replacement, setReplacement] = useState<File | null>(null);
  const [imageReview, setImageReview] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const alive = useRef(true);
  const lock = useRef(false);
  const revision = useRef(0);
  const readRequest = useRef<AbortController | null>(null);
  const writeRequest = useRef<AbortController | null>(null);
  const callbacks = useRef({ isCurrentSession, onBusyChange, onChanged });
  useLayoutEffect(() => {
    callbacks.current = { isCurrentSession, onBusyChange, onChanged };
  }, [isCurrentSession, onBusyChange, onChanged]);
  const valid = () => alive.current && callbacks.current.isCurrentSession();
  function fail(caught: unknown) {
    if (!valid()) return;
    if (status(caught) === 403) {
      setDenied(true);
      setRows(null);
      setCurrent(null);
    }
    setError(errorText(caught));
  }
  async function readList(
    selection?: { id: string; mode: "edit" | "replace" },
    review = false,
  ) {
    if (lock.current || !valid() || denied) return;
    readRequest.current?.abort();
    const controller = new AbortController();
    readRequest.current = controller;
    const started = ++revision.current;
    setLoading(true);
    setReviewed(false);
    setRows(null);
    setPage(1);
    setError("");
    try {
      const result = await authorized<{ data: AdminBanner[] }>(
        "/admin/banners",
        { signal: controller.signal, cache: "no-store" },
      );
      if (!valid() || revision.current !== started) return;
      if (
        !result ||
        !Array.isArray(result.data) ||
        !result.data.every(bannerRecord)
      )
        throw new Error();
      setRows(result.data);
      setStale(false);
      if (selection) {
        const banner = result.data.find((entry) => entry.id === selection.id);
        if (!banner) {
          setView("list");
          setError("Banner não encontrado. Atualize a lista.");
        } else {
          setCurrent(banner);
          setReplacement(null);
          setImageReview(false);
          setView(selection.mode);
        }
      } else if (review) setReviewed(true);
    } catch (caught) {
      if (revision.current === started) {
        setStale(true);
        fail(caught);
      }
    } finally {
      if (valid() && revision.current === started) setLoading(false);
    }
  }
  const initialRead = useRef(() => {
    void readList();
  });
  useLayoutEffect(() => {
    initialRead.current = () => {
      void readList();
    };
  });
  function stop() {
    alive.current = false;
    revision.current++;
    readRequest.current?.abort();
    writeRequest.current?.abort();
    if (lock.current) callbacks.current.onBusyChange(false);
  }
  useEffect(() => {
    alive.current = true;
    let active = true;
    void Promise.resolve().then(() => {
      if (active) initialRead.current();
    });
    return () => {
      active = false;
      stop();
    };
  }, []);
  function markBusy(value: boolean) {
    lock.current = value;
    setBusy(value);
    callbacks.current.onBusyChange(value);
  }
  function back() {
    if (lock.current) return;
    revision.current++;
    readRequest.current?.abort();
    setLoading(false);
    setView("list");
    setCurrent(null);
    setReplacement(null);
    setImageReview(false);
    setError("");
  }
  async function write(
    path: string,
    method: "POST" | "PATCH",
    body: BodyInit,
  ): Promise<AdminBanner> {
    const controller = new AbortController();
    writeRequest.current = controller;
    const interrupted = new Promise<never>((_, reject) =>
      controller.signal.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true },
      ),
    );
    const timer = window.setTimeout(() => controller.abort(), 15000);
    try {
      const result = await Promise.race([
        authorized<AdminBanner>(path, {
          method,
          body,
          signal: controller.signal,
        }),
        interrupted,
      ]);
      if (!bannerRecord(result)) throw new Error();
      return result;
    } finally {
      window.clearTimeout(timer);
      if (writeRequest.current === controller) writeRequest.current = null;
    }
  }
  function clearCreation() {
    sessionStorage.removeItem(guardKey);
    setPendingTitle(null);
    setReviewed(false);
  }
  function accept(result: AdminBanner, message: string) {
    const ordered = [
      ...(rows ?? []).filter((banner) => banner.id !== result.id),
      result,
    ].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
    setRows(ordered);
    setPage(
      Math.floor(ordered.findIndex((banner) => banner.id === result.id) / 6) +
        1,
    );
    setView("list");
    setCurrent(null);
    setReplacement(null);
    setImageReview(false);
    setStale(false);
    setNotice(message);
    callbacks.current.onChanged?.();
  }
  async function save(input: BannerInput, file: File | null): Promise<boolean> {
    if (lock.current || loading || denied || stale || !valid()) return false;
    const creating = view === "new";
    if (creating && (pendingTitle || storageBlocked || !file)) return false;
    if (!creating && (!current || view !== "edit")) return false;
    const fields = creating ? input : changedBannerFields(current!, input);
    if (!creating && !Object.keys(fields).length) {
      setView("list");
      setNotice("Nenhuma alteração no banner.");
      return true;
    }
    if (creating) {
      try {
        sessionStorage.setItem(guardKey, input.title);
        if (sessionStorage.getItem(guardKey) !== input.title) throw new Error();
        setPendingTitle(input.title);
      } catch {
        setStorageBlocked(true);
        setError(
          "Não foi possível proteger o cadastro neste navegador. Confira os banners antes de usar outra aba.",
        );
        return false;
      }
    }
    let body: BodyInit;
    if (creating) {
      const data = new FormData();
      data.append("title", input.title);
      data.append("link", input.link ?? "");
      data.append("active", String(input.active));
      data.append("sortOrder", String(input.sortOrder));
      data.append("image", file!);
      body = data;
    } else body = JSON.stringify(fields);
    markBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await write(
        creating ? "/admin/banners" : `/admin/banners/${current!.id}`,
        creating ? "POST" : "PATCH",
        body,
      );
      if (!valid()) return false;
      if (!creating && result.id !== current!.id) throw new Error();
      if (creating) clearCreation();
      accept(result, creating ? "Banner cadastrado." : "Banner atualizado.");
      return true;
    } catch (caught) {
      if (!valid()) return false;
      if (creating && [400, 401, 403, 404, 413].includes(status(caught) ?? 0)) {
        try {
          clearCreation();
        } catch {
          setStorageBlocked(true);
        }
        fail(caught);
      } else {
        setView("list");
        setRows(null);
        setCurrent(null);
        setStale(true);
        setReviewed(false);
        if (creating)
          setError(
            "Não foi possível confirmar o cadastro. O banner pode ter sido criado. Revise os cadastros antes de tentar novamente.",
          );
        else fail(caught);
      }
      return false;
    } finally {
      if (alive.current) markBusy(false);
    }
  }
  async function replaceImage() {
    if (
      lock.current ||
      loading ||
      stale ||
      !current ||
      !replacement ||
      !imageReview ||
      !valid()
    )
      return;
    const snapshot = current;
    const body = new FormData();
    body.append("image", replacement);
    markBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await write(
        `/admin/banners/${snapshot.id}/image`,
        "POST",
        body,
      );
      if (!valid()) return;
      if (result.id !== snapshot.id) throw new Error();
      accept(result, "Imagem do banner atualizada.");
    } catch (caught) {
      if (valid()) {
        setView("list");
        setRows(null);
        setCurrent(null);
        setReplacement(null);
        setImageReview(false);
        setStale(true);
        fail(caught);
      }
    } finally {
      if (alive.current) markBusy(false);
    }
  }
  if (denied)
    return (
      <p className="error" role="alert">
        Acesso restrito a administradores. Entre com uma conta autorizada.
      </p>
    );
  return (
    <section className="admin-banners-area" aria-label="Gestão de banners">
      <p className="muted">
        Organize os banners da página inicial. Somente os banners ativos
        aparecem na loja.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="auth-success" role="status">
          {notice}
        </p>
      )}
      {storageBlocked && (
        <p className="error" role="alert">
          O armazenamento da proteção de cadastro está indisponível. Novos
          cadastros estão bloqueados; confira os banners existentes antes de
          tentar em outra aba.
        </p>
      )}
      {pendingTitle && (
        <div
          className="admin-recovery"
          aria-label="Conferência de cadastro de banner"
        >
          <p>
            Confira se o banner <strong>{pendingTitle}</strong> já foi
            cadastrado. Uma resposta anterior pode ter se perdido.
          </p>
          <button
            className="outline"
            disabled={busy || loading}
            onClick={() => {
              setView("list");
              void readList(undefined, true);
            }}
          >
            Revisar cadastros
          </button>
          {reviewed && rows && view === "list" && !stale && (
            <>
              <p>
                Revise a lista antes de liberar outro cadastro. Títulos iguais
                podem aparecer em mais de um banner.
              </p>
              <button
                className="clear"
                disabled={busy || loading}
                onClick={() => {
                  try {
                    clearCreation();
                  } catch {
                    setStorageBlocked(true);
                  }
                }}
              >
                Liberar novo cadastro
              </button>
            </>
          )}
        </div>
      )}
      {view === "list" ? (
        <>
          <div className="banner-toolbar">
            <button
              className="primary"
              disabled={
                busy || loading || stale || !!pendingTitle || storageBlocked
              }
              onClick={() => {
                setView("new");
                setError("");
                setNotice("");
              }}
            >
              Novo banner
            </button>
            <button
              className="outline"
              disabled={busy || loading}
              onClick={() => void readList()}
            >
              Atualizar banners
            </button>
          </div>
          {loading ? (
            <p role="status">Carregando banners…</p>
          ) : rows && !stale ? (
            <>
              <p className="muted">
                {rows.length} banners nesta lista. A API consulta até 100
                registros por vez; a loja exibe até 20 ativos.
              </p>
              {!rows.length && <p>Nenhum banner cadastrado.</p>}
              <div className="admin-banner-list">
                {rows.slice((page - 1) * 6, page * 6).map((banner) => (
                  <article className="admin-banner-card" key={banner.id}>
                    <BannerPreview
                      banner={banner}
                      isCurrentSession={() => valid()}
                      onForbidden={() => {
                        setDenied(true);
                        setRows(null);
                      }}
                    />
                    <div className="admin-banner-content">
                      <div className="admin-banner-heading">
                        <h3>{banner.title}</h3>
                        <div className="admin-badges">
                          <span>{banner.active ? "Ativo" : "Inativo"}</span>
                          <span>Ordem {banner.sortOrder}</span>
                        </div>
                      </div>
                      <p className="muted">
                        {banner.link
                          ? `Destino: ${banner.link}`
                          : "Sem link personalizado"}
                      </p>
                      <div className="button-row">
                        <button
                          className="outline"
                          disabled={busy || loading}
                          aria-label={`Editar ${banner.title}`}
                          onClick={() => {
                            setNotice("");
                            void readList({ id: banner.id, mode: "edit" });
                          }}
                        >
                          Editar dados
                        </button>
                        <button
                          className="outline"
                          disabled={busy || loading}
                          aria-label={`Trocar imagem de ${banner.title}`}
                          onClick={() => {
                            setNotice("");
                            void readList({ id: banner.id, mode: "replace" });
                          }}
                        >
                          Trocar imagem
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
              {rows.length > 6 && (
                <nav
                  className="shipping-pagination"
                  aria-label="Páginas dos banners"
                >
                  <button
                    disabled={busy || loading || page <= 1}
                    onClick={() => setPage((value) => value - 1)}
                  >
                    Anterior
                  </button>
                  <span>
                    Página {page} de {Math.ceil(rows.length / 6)}
                  </span>
                  <button
                    disabled={
                      busy || loading || page >= Math.ceil(rows.length / 6)
                    }
                    onClick={() => setPage((value) => value + 1)}
                  >
                    Próxima
                  </button>
                </nav>
              )}
            </>
          ) : null}
        </>
      ) : view === "new" || view === "edit" ? (
        <BannerEditor
          key={view === "new" ? "create" : current!.id}
          banner={view === "edit" ? current! : undefined}
          busy={busy}
          onSave={save}
          onCancel={back}
          isCurrentSession={() => valid()}
          preview={
            view === "edit" && current ? (
              <BannerPreview
                banner={current}
                isCurrentSession={() => valid()}
                onForbidden={() => {
                  setDenied(true);
                  setCurrent(null);
                  setRows(null);
                }}
              />
            ) : undefined
          }
        />
      ) : (
        current && (
          <section className="banner-replacement">
            <h3>Trocar imagem de {current.title}</h3>
            <p className="muted">
              O título, o destino, a ordem e a situação do banner serão
              mantidos.
            </p>
            <BannerImagePicker
              key={current.id}
              label="Nova imagem"
              disabled={busy || imageReview}
              onChange={(file) => {
                setReplacement(file);
                setImageReview(false);
              }}
              isCurrentSession={() => valid()}
            />
            {imageReview ? (
              <div className="admin-recovery">
                <p>Confirmar a troca da imagem deste banner?</p>
                <div className="button-row">
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => void replaceImage()}
                  >
                    {busy ? "Salvando…" : "Confirmar troca"}
                  </button>
                  <button
                    className="clear"
                    disabled={busy}
                    onClick={() => setImageReview(false)}
                  >
                    Voltar à imagem
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="primary"
                disabled={busy || !replacement}
                onClick={() => setImageReview(true)}
              >
                Revisar imagem
              </button>
            )}
            <button className="clear" disabled={busy} onClick={back}>
              Voltar aos banners
            </button>
          </section>
        )
      )}
    </section>
  );
}
