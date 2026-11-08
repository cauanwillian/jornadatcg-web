export interface AdminBanner {
  id: string;
  title: string;
  link: string | null;
  active: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  imageUrl: string;
}

export interface BannerDraft {
  title: string;
  link: string;
  active: boolean;
  sortOrder: string;
}

export interface BannerInput {
  title: string;
  link: string | null;
  active: boolean;
  sortOrder: number;
}

export function bannerDraft(banner?: AdminBanner): BannerDraft {
  return {
    title: banner?.title ?? "",
    link: banner?.link ?? "",
    active: banner?.active ?? false,
    sortOrder: String(banner?.sortOrder ?? 0),
  };
}

export function validateBanner(draft: BannerDraft): {
  input?: BannerInput;
  errors: Partial<Record<keyof BannerDraft, string>>;
} {
  const errors: Partial<Record<keyof BannerDraft, string>> = {};
  const title = draft.title.trim();
  if (!title || title.length > 120) {
    errors.title = "Informe um título de até 120 caracteres.";
  }
  const link = draft.link === "" ? null : draft.link;
  if (
    link !== null &&
    (link.length > 500 ||
      !/^\/(?!\/)/.test(link) ||
      /[\\\s%]/.test(link) ||
      [...link].some((character) => character.charCodeAt(0) < 32))
  ) {
    errors.link = "Use um caminho interno, como /#catalogo, sem espaços ou caracteres codificados.";
  }
  const sortOrder = draft.sortOrder.trim();
  if (!/^(0|[1-9]\d{0,5})$/.test(sortOrder)) {
    errors.sortOrder = "Informe uma ordem inteira entre 0 e 999999.";
  }
  if (typeof draft.active !== "boolean") {
    errors.active = "Informe se o banner está ativo.";
  }
  if (Object.keys(errors).length) return { errors };
  return {
    errors,
    input: { title, link, active: draft.active, sortOrder: Number(sortOrder) },
  };
}

/** Only editable metadata is sent; an image uses its separate upload endpoint. */
export function changedBannerFields(
  before: AdminBanner,
  input: BannerInput,
): Partial<BannerInput> {
  const changes: Partial<BannerInput> = {};
  if (before.title !== input.title) changes.title = input.title;
  if (before.link !== input.link) changes.link = input.link;
  if (before.active !== input.active) changes.active = input.active;
  if (before.sortOrder !== input.sortOrder) changes.sortOrder = input.sortOrder;
  return changes;
}

export function validateBannerFile(file: File | null): string | null {
  if (!file) return "Selecione a imagem do banner.";
  if (!file.size || file.size > 5 * 1024 * 1024) {
    return "Envie uma imagem de até 5 MB, com conteúdo válido.";
  }
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    return "Use uma imagem PNG, JPEG ou WebP estática.";
  }
  return null;
}

/** The server remains responsible for checking the actual format and animation. */
export function inspectBannerImage(
  file: File,
  signal?: AbortSignal,
): Promise<void> {
  const error = validateBannerFile(file);
  if (error) return Promise.reject(new Error(error));
  if (signal?.aborted) {
    return Promise.reject(new Error("Verificação da imagem cancelada."));
  }
  return new Promise((resolve, reject) => {
    let image: HTMLImageElement | undefined;
    let objectUrl: string | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = (message?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (image) {
        image.onload = null;
        image.onerror = null;
        image.src = "";
      }
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (message) reject(new Error(message));
      else resolve();
    };
    const abort = () => finish("Verificação da imagem cancelada.");
    try {
      image = new Image();
      objectUrl = URL.createObjectURL(file);
      image.onload = () => {
        if (image?.naturalWidth !== 1600 || image?.naturalHeight !== 500) {
          finish("Use uma imagem de 1600 × 500 pixels.");
        } else finish();
      };
      image.onerror = () => finish("Não foi possível ler a imagem. Escolha outro arquivo.");
      signal?.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => finish("A verificação da imagem demorou demais. Tente novamente."), 15000);
      image.src = objectUrl;
    } catch {
      finish("Não foi possível ler a imagem. Escolha outro arquivo.");
    }
  });
}
