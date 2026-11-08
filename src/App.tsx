import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { api, imageUrl, money } from "./api";
import type { Product, Banner, Filters } from "./api";
import "./App.css";
import { AccountActions, AddButton } from "./Shop";
type Page = {
  data: Product[];
  pagination: { total: number; hasMore: boolean };
};
const initial = {
  name: "",
  categoryId: "",
  conditionId: "",
  languageId: "",
  rarity: "",
  minPrice: "",
  maxPrice: "",
  stock: "",
  sort: "newest",
};
function CardImage({
  product,
  large = false,
}: {
  product: Product;
  large?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const src = large
    ? product.card.imageLarge || product.card.imageSmall
    : product.card.imageSmall;
  return src && !failed ? (
    <img
      loading="lazy"
      src={src}
      alt={product.card.name}
      onError={() => setFailed(true)}
    />
  ) : (
    <div className="card-placeholder">
      <span>J</span>
      <small>Imagem indisponível</small>
    </div>
  );
}
function ProductCard({
  product,
  onOpen,
}: {
  product: Product;
  onOpen: (p: Product) => void;
}) {
  return (
    <article className="product">
      <button className="card-link" onClick={() => onOpen(product)}>
        <div className="card-art">
          <CardImage product={product} />
        </div>
        <h3>{product.card.name}</h3>
        <p className="set-name">
          {product.card.set.name} · {product.card.number}
        </p>
      </button>
      <div className="tags">
        <span>{product.condition.name}</span>
        <span>{product.language.name}</span>
      </div>
      <div className="price-row">
        <strong>{money(product.price)}</strong>
        <small>{product.availableQuantity} disponíveis</small>
      </div>
      <AddButton id={product.id} available={product.inStock} />
    </article>
  );
}
function Details({ product, close }: { product: Product; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [quantity, setQuantity] = useState(1);
  const [zip, setZip] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [quotes, setQuotes] = useState<{
    options: {
      provider: string;
      serviceName: string;
      amount: string;
      deliveryDays: number;
    }[];
    message: string;
  } | null>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  async function estimate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setQuotes(null);
    try {
      setQuotes(
        await api(
          `/catalog/products/${product.id}/shipping-estimate?zipCode=${encodeURIComponent(zip)}&quantity=${quantity}`,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao consultar");
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog ref={dialog} onCancel={close} aria-labelledby="detail-title">
      <button className="close" aria-label="Fechar detalhes" onClick={close}>
        ×
      </button>
      <div className="detail-layout">
        <div className="detail-art">
          <CardImage product={product} large />
        </div>
        <div>
          <p className="eyebrow">{product.card.set.name}</p>
          <h2 id="detail-title">{product.card.name}</h2>
          <p>
            {product.card.number} ·{" "}
            {product.card.rarity || "Raridade não informada"}
          </p>
          <div className="tags">
            <span>{product.condition.name}</span>
            <span>{product.language.name}</span>
          </div>
          <h2>{money(product.price)}</h2>
          <p>{product.observation}</p>
          <p className="muted">
            {product.availableQuantity} unidades disponíveis
          </p>
          <form onSubmit={estimate}>
            <label>
              Quantidade
              <input
                type="number"
                min="1"
                max={Math.min(70, product.availableQuantity)}
                value={quantity}
                onChange={(e) => {
                  setQuantity(Number(e.target.value));
                  setQuotes(null);
                }}
                required
              />
            </label>
            <label>
              Estimar frete
              <input
                placeholder="00000-000"
                value={zip}
                onChange={(e) => {
                  setZip(e.target.value);
                  setQuotes(null);
                }}
                pattern="[0-9]{5}-?[0-9]{3}"
                inputMode="numeric"
                required
              />
            </label>
            <button className="primary" disabled={busy || !product.inStock}>
              {busy ? "Consultando…" : "Calcular frete"}
            </button>
          </form>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {quotes && (
            <div aria-live="polite">
              {quotes.options.map((q, i) => (
                <p className="quote" key={`${q.provider}-${i}`}>
                  <span>
                    {q.serviceName}
                    <small>
                      {q.deliveryDays} dias úteis
                      {q.provider.endsWith(":sandbox") ? " · simulação" : ""}
                    </small>
                  </span>
                  <strong>{money(q.amount)}</strong>
                </p>
              ))}
              {!quotes.options.length && (
                <p>Nenhum serviço disponível para este CEP.</p>
              )}
              <p className="muted">{quotes.message}</p>
            </div>
          )}
          <AddButton
            id={product.id}
            quantity={quantity}
            available={product.inStock}
          />
        </div>
      </div>
    </dialog>
  );
}
export default function App() {
  const [filters, setFilters] = useState(initial);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [options, setOptions] = useState<Filters>({
    categories: [],
    conditions: [],
    languages: [],
    rarities: [],
  });
  const [featured, setFeatured] = useState<Product[]>([]);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [slide, setSlide] = useState(0);
  const [selected, setSelected] = useState<Product | null>(null);
  const [detailError, setDetailError] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    api<Filters>("/catalog/filters", c.signal)
      .then(setOptions)
      .catch(() => {});
    api<{ data: Product[] }>("/catalog/featured", c.signal)
      .then((x) => setFeatured(x.data))
      .catch(() => {});
    api<{ data: Banner[] }>("/banners", c.signal)
      .then((x) => setBanners(x.data))
      .catch(() => {});
    return () => c.abort();
  }, [retry]);
  useEffect(() => {
    const reload = () => {
      setPage(1);
      setProducts([]);
      setLoading(true);
      setSelected(null);
      setRetry((value) => value + 1);
    };
    window.addEventListener("jornada-catalog-changed", reload);
    return () => window.removeEventListener("jornada-catalog-changed", reload);
  }, []);
  useEffect(() => {
    const c = new AbortController();
    let active = true;
    const q = new URLSearchParams({ page: String(page), limit: "24" });
    Object.entries(filters).forEach(([k, v]) => {
      if (v) q.set(k, v);
    });
    api<Page>(`/catalog/products?${q}`, c.signal)
      .then((r) => {
        if (active) {
          setProducts((old) =>
            page === 1
              ? r.data
              : [
                  ...old,
                  ...r.data.filter((x) => !old.some((p) => p.id === x.id)),
                ],
          );
          setTotal(r.pagination.total);
          setMore(r.pagination.hasMore);
          setError("");
        }
      })
      .catch((e) => {
        if (active)
          setError(e instanceof Error ? e.message : "API indisponível");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      c.abort();
    };
  }, [filters, page, retry]);
  function change(key: keyof typeof initial, value: string) {
    setFilters((old) => ({ ...old, [key]: value }));
    setPage(1);
    setProducts([]);
    setLoading(true);
    setError("");
  }
  async function open(p: Product) {
    setDetailLoading(true);
    setDetailError("");
    try {
      setSelected(await api<Product>(`/catalog/products/${p.id}`));
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : "Produto indisponível");
    } finally {
      setDetailLoading(false);
    }
  }
  const banner = banners[slide % banners.length];
  return (
    <>
      <div className="top-note">Sua próxima carta favorita está aqui.</div>
      <header>
        <div className="header-inner">
          <a className="brand" href="/" aria-label="Jornada TCG início">
            <span className="brand-mark">J</span>
            <span>
              JORNADA<small>TRADING CARD GAME</small>
            </span>
          </a>
          <form
            className="search"
            onSubmit={(e) => {
              e.preventDefault();
              change("name", search);
            }}
          >
            <input
              aria-label="Pesquisar cartas"
              placeholder="Qual carta você está procurando?"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button aria-label="Pesquisar">⌕</button>
          </form>
          <AccountActions />
          <a className="header-link" href="#catalogo">
            Explorar cartas ↗
          </a>
        </div>
      </header>
      <main>
        <section className="hero" aria-label="Novidades">
          {banner ? (
            <>
              <a href={banner.link || "#catalogo"}>
                <img src={imageUrl(banner.imageUrl)} alt={banner.title} />
              </a>
              {banners.length > 1 && (
                <div className="slide-controls">
                  {banners.map((b, i) => (
                    <button
                      key={b.id}
                      aria-label={`Exibir banner ${i + 1}`}
                      aria-pressed={slide === i}
                      onClick={() => setSlide(i)}
                    >
                      {i + 1}
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="hero-fallback">
              <div>
                <p className="eyebrow">BEM-VINDO À JORNADA</p>
                <h1>
                  Cada carta,
                  <br />
                  uma nova história.
                </h1>
                <p>Encontre a próxima peça da sua coleção.</p>
                <a className="cream-button" href="#catalogo">
                  Explore o catálogo ↗
                </a>
              </div>
              <div className="hero-symbol" aria-hidden="true">
                J<span>TCG</span>
              </div>
            </div>
          )}
        </section>
        <div className="benefits">
          <span>✦ Cartas para a sua coleção</span>
          <span>↗ Compre e acumule</span>
          <span>◇ Solicite o envio quando quiser</span>
        </div>
        {featured.length > 0 && (
          <section className="featured">
            <div className="section-heading">
              <div>
                <p className="eyebrow">ESCOLHAS DA LOJA</p>
                <h2>Em destaque</h2>
              </div>
              <a href="#catalogo">Ver todas as cartas ↗</a>
            </div>
            <div className="featured-grid">
              {featured.map((p) => (
                <ProductCard key={p.id} product={p} onOpen={open} />
              ))}
            </div>
          </section>
        )}
        <section id="catalogo">
          <div className="section-heading">
            <div>
              <p className="eyebrow">ENCONTRE SUA PRÓXIMA CARTA</p>
              <h2>Explore a coleção</h2>
            </div>
            <span className="muted">{total} produtos</span>
          </div>
          <div className="catalog-layout">
            <aside>
              <h3>Filtrar cartas</h3>
              {(
                [
                  ["categoryId", "Categoria", options.categories],
                  ["conditionId", "Condição", options.conditions],
                  ["languageId", "Idioma", options.languages],
                ] as const
              ).map(([key, label, items]) => (
                <label key={key}>
                  {label}
                  <select
                    value={filters[key]}
                    onChange={(e) => change(key, e.target.value)}
                  >
                    <option value="">Todas</option>
                    {items.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <label>
                Raridade
                <select
                  value={filters.rarity}
                  onChange={(e) => change("rarity", e.target.value)}
                >
                  <option value="">Todas</option>
                  {options.rarities.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </label>
              <div className="price-filter">
                <label>
                  Preço mínimo
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={filters.minPrice}
                    onChange={(e) => change("minPrice", e.target.value)}
                  />
                </label>
                <label>
                  Preço máximo
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={filters.maxPrice}
                    onChange={(e) => change("maxPrice", e.target.value)}
                  />
                </label>
              </div>
              <label>
                Disponibilidade
                <select
                  value={filters.stock}
                  onChange={(e) => change("stock", e.target.value)}
                >
                  <option value="">Todos os produtos</option>
                  <option value="available">Com estoque</option>
                  <option value="unavailable">Esgotados</option>
                </select>
              </label>
              <button
                className="clear"
                onClick={() => {
                  setRetry((x) => x + 1);
                  setFilters(initial);
                  setSearch("");
                  setPage(1);
                  setProducts([]);
                  setLoading(true);
                }}
              >
                Limpar filtros
              </button>
            </aside>
            <div>
              <div className="catalog-toolbar">
                <span>
                  {filters.name
                    ? `Resultados para “${filters.name}”`
                    : "Cartas avulsas"}
                </span>
                <label className="sort">
                  Ordenar
                  <select
                    value={filters.sort}
                    onChange={(e) => change("sort", e.target.value)}
                  >
                    <option value="newest">Mais recentes</option>
                    <option value="oldest">Mais antigas</option>
                    <option value="price_asc">Menor preço</option>
                    <option value="price_desc">Maior preço</option>
                  </select>
                </label>
              </div>
              {error ? (
                <div className="empty" role="alert">
                  <h3>Não foi possível carregar o catálogo</h3>
                  <p>{error}</p>
                  <button
                    className="primary"
                    onClick={() => {
                      setLoading(true);
                      setRetry((x) => x + 1);
                    }}
                  >
                    Tentar novamente
                  </button>
                </div>
              ) : (
                <>
                  <div className="product-grid">
                    {products.map((p) => (
                      <ProductCard key={p.id} product={p} onOpen={open} />
                    ))}
                  </div>
                  {loading && (
                    <p className="empty" role="status">
                      Carregando cartas…
                    </p>
                  )}
                  {!loading && !products.length && (
                    <div className="empty">
                      <h3>Nenhuma carta encontrada</h3>
                      <p>Tente outros filtros ou uma nova pesquisa.</p>
                    </div>
                  )}
                  {more && !loading && (
                    <button
                      className="load-more"
                      onClick={() => {
                        setLoading(true);
                        setPage((x) => x + 1);
                      }}
                    >
                      Carregar mais cartas ↓
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </section>
      </main>
      <footer>
        <a className="brand" href="/">
          JORNADA TCG
        </a>
        <p>Sua coleção. Seu tempo. Sua jornada.</p>
        <small>
          Compre suas cartas, acumule pedidos e solicite o envio quando quiser.
        </small>
      </footer>
      {detailLoading && (
        <div className="notice" role="status">
          Carregando detalhes…
        </div>
      )}
      {detailError && (
        <div className="notice" role="alert">
          {detailError}
          <button onClick={() => setDetailError("")}>Fechar</button>
        </div>
      )}
      {selected && (
        <Details
          key={selected.id}
          product={selected}
          close={() => setSelected(null)}
        />
      )}
    </>
  );
}
