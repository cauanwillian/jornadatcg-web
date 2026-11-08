import { useEffect, useId, useRef, useState } from "react";
import type { ExternalCard } from "./admin-cards";
import { isImportableCard } from "./admin-cards";
import type { LocalCard } from "./admin-products";
import { useAdminCards } from "./useAdminCards";

type Card = ExternalCard | LocalCard;
function CardArt({ card, large = false }: { card: Card; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  const src = large
    ? card.images.large || card.images.small
    : card.images.small;
  return (
    <div className={large ? "card-library-detail-art" : "card-library-art"}>
      {src && !failed ? (
        <img
          src={src}
          alt={card.name}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <span>Imagem indisponível</span>
      )}
    </div>
  );
}
function CardSummary({ card }: { card: Card }) {
  return (
    <div className="card-library-caption">
      <h4>{card.name}</h4>
      <p>
        {card.set.name} · {card.number}
        {card.set.printedTotal !== null ? `/${card.set.printedTotal}` : ""}
      </p>
    </div>
  );
}
function CardDetail({
  card,
  busy,
  uncertain,
  onBack,
  onImport,
  onProducts,
}: {
  card: Card;
  busy: boolean;
  uncertain: boolean;
  onBack: () => void;
  onImport: () => void;
  onProducts?: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const local = "id" in card;
  useEffect(() => {
    heading.current?.focus();
  }, [card]);
  return (
    <section className="card-library-detail" aria-label="Detalhes da carta">
      <button className="outline" disabled={busy} onClick={onBack}>
        Voltar às cartas
      </button>
      <div className="card-library-detail-grid">
        <CardArt key={card.externalId} card={card} large />
        <div>
          <h3 ref={heading} tabIndex={-1}>
            {card.name}
          </h3>
          <dl className="card-library-facts">
            <div>
              <dt>Coleção</dt>
              <dd>{card.set.name}</dd>
            </div>
            <div>
              <dt>Número da carta</dt>
              <dd>
                {card.number}
                {card.set.printedTotal !== null
                  ? `/${card.set.printedTotal}`
                  : ""}
              </dd>
            </div>
            <div>
              <dt>Raridade</dt>
              <dd>{card.rarity || "Não informada"}</dd>
            </div>
            <div>
              <dt>Artista</dt>
              <dd>{card.artist || "Não informado"}</dd>
            </div>
          </dl>
          <p className="card-library-help">
            {local
              ? "Esta carta está na biblioteca. Para colocá-la à venda, crie um anúncio na gestão de produtos."
              : "A carta entrará na biblioteca. Preço e estoque serão definidos ao criar um anúncio."}
          </p>
          {local ? (
            onProducts && (
              <button className="primary" disabled={busy} onClick={onProducts}>
                Ir para gestão de produtos
              </button>
            )
          ) : (
            <>
              {uncertain && (
                <p className="card-library-help">
                  A importação pode ter sido concluída. Ao retomar esta mesma
                  carta, a API reutiliza o cadastro existente.
                </p>
              )}
              <button
                className="primary"
                disabled={busy || !isImportableCard(card.externalId)}
                onClick={onImport}
              >
                {busy
                  ? "Importando carta…"
                  : uncertain
                    ? "Verificar ou retomar importação"
                    : "Importar carta"}
              </button>
              {!isImportableCard(card.externalId) && (
                <p className="card-library-help">
                  Esta carta não pode ser importada pelo provedor atual. Faça
                  uma nova pesquisa.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
function Pagination({
  page,
  totalPages,
  disabled,
  onChange,
}: {
  page: number;
  totalPages: number;
  disabled: boolean;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <nav className="card-library-pagination" aria-label="Páginas das cartas">
      <button
        className="outline"
        disabled={disabled || page <= 1}
        onClick={() => onChange(page - 1)}
      >
        Anterior
      </button>
      <span>
        Página {page} de {totalPages}
      </span>
      <button
        className="outline"
        disabled={disabled || page >= Math.min(10000, totalPages)}
        onClick={() => onChange(page + 1)}
      >
        Próxima
      </button>
    </nav>
  );
}
export function AdminCardsArea({
  isCurrentSession,
  onBusyChange,
  onOpenProducts,
}: {
  isCurrentSession: () => boolean;
  onBusyChange: (busy: boolean) => void;
  onOpenProducts?: () => void;
}) {
  const state = useAdminCards(isCurrentSession, onBusyChange);
  const id = useId();
  if (!isCurrentSession()) return null;
  if (state.denied)
    return (
      <p className="error" role="alert">
        Acesso restrito a administradores. Entre novamente com uma conta
        autorizada.
      </p>
    );
  const disabled = state.busy || Boolean(state.loading);
  return (
    <section className="cards-area" aria-label="Biblioteca de cartas">
      <p className="card-library-help">
        Consulte as cartas da loja ou importe uma carta da pesquisa Pokémon. A
        biblioteca reúne os dados das cartas; os anúncios definem preço e
        estoque.
      </p>
      <nav className="card-library-tabs" aria-label="Origem das cartas">
        <button
          aria-pressed={state.view === "local"}
          disabled={state.busy}
          onClick={() => state.changeView("local")}
        >
          Cartas cadastradas
        </button>
        <button
          aria-pressed={state.view === "external"}
          disabled={state.busy}
          onClick={() => state.changeView("external")}
        >
          Pesquisar na API
        </button>
      </nav>
      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {state.notice && (
        <p className="auth-success" role="status">
          {state.notice}
        </p>
      )}
      {state.selected ? (
        <CardDetail
          card={state.selected}
          busy={state.busy}
          uncertain={state.uncertain}
          onBack={state.back}
          onImport={() => void state.importCard()}
          onProducts={
            onOpenProducts
              ? () => {
                  if (state.canNavigate()) onOpenProducts();
                }
              : undefined
          }
        />
      ) : (
        <>
          {state.view === "local" ? (
            <>
              <div className="card-library-toolbar">
                <h3>Cartas cadastradas</h3>
                <button
                  className="outline"
                  disabled={disabled}
                  onClick={state.reloadLocal}
                >
                  Atualizar biblioteca
                </button>
              </div>
              <form
                className="card-library-search"
                onSubmit={(event) => {
                  event.preventDefault();
                  state.filterLocal();
                }}
              >
                <label htmlFor={`${id}-local`}>
                  Nome da carta
                  <input
                    id={`${id}-local`}
                    value={state.localDraft}
                    maxLength={200}
                    disabled={disabled}
                    onChange={(event) =>
                      state.changeLocalDraft(event.target.value)
                    }
                  />
                </label>
                <button className="outline" disabled={disabled}>
                  Filtrar cartas
                </button>
              </form>
              {state.local && !state.loading && (
                <>
                  <p className="card-library-count">
                    {state.local.pagination.total}{" "}
                    {state.local.pagination.total === 1
                      ? "carta cadastrada"
                      : "cartas cadastradas"}
                    {state.localName ? " para esta pesquisa" : ""}.
                  </p>
                  {!state.local.data.length && (
                    <p className="card-library-empty">
                      Nenhuma carta encontrada na biblioteca. Pesquise na API
                      para importar uma carta.
                    </p>
                  )}
                  <ul className="card-library-grid">
                    {state.local.data.map((card) => (
                      <li className="card-library-item" key={card.id}>
                        <CardArt card={card} />
                        <CardSummary card={card} />
                        <button
                          className="outline"
                          onClick={() => void state.openLocal(card.id)}
                          disabled={disabled}
                        >
                          Ver detalhes de {card.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <Pagination
                    page={state.local.pagination.page}
                    totalPages={state.local.pagination.totalPages}
                    disabled={disabled}
                    onChange={state.changeLocalPage}
                  />
                </>
              )}
            </>
          ) : (
            <>
              <h3>Pesquisar na API Pokémon</h3>
              <form
                className="card-library-search card-library-external-search"
                noValidate
                onSubmit={(event) => {
                  event.preventDefault();
                  void state.search();
                }}
              >
                <label htmlFor={`${id}-name`}>
                  Nome (opcional)
                  <input
                    id={`${id}-name`}
                    maxLength={200}
                    value={state.draft.name}
                    disabled={disabled}
                    onChange={(event) =>
                      state.changeDraft("name", event.target.value)
                    }
                    aria-invalid={Boolean(state.validation.name)}
                    aria-describedby={
                      state.validation.name ? `${id}-name-error` : undefined
                    }
                  />
                </label>
                {state.validation.name && (
                  <small className="field-error" id={`${id}-name-error`}>
                    {state.validation.name}
                  </small>
                )}
                <label htmlFor={`${id}-code`}>
                  Código da carta (opcional)
                  <input
                    id={`${id}-code`}
                    maxLength={33}
                    value={state.draft.code}
                    disabled={disabled}
                    onChange={(event) =>
                      state.changeDraft("code", event.target.value)
                    }
                    aria-invalid={Boolean(state.validation.code)}
                    aria-describedby={`${id}-code-help${state.validation.code ? ` ${id}-code-error` : ""}`}
                  />
                </label>
                <p className="card-library-help" id={`${id}-code-help`}>
                  Informe nome, código ou ambos. Exemplo: 025/182 representa o
                  número da carta e o total impresso da coleção.
                </p>
                {state.validation.code && (
                  <small className="field-error" id={`${id}-code-error`}>
                    {state.validation.code}
                  </small>
                )}
                {state.validation.general && (
                  <p className="error" role="alert">
                    {state.validation.general}
                  </p>
                )}
                <button className="primary" disabled={disabled}>
                  {state.loading === "search"
                    ? "Pesquisando cartas…"
                    : "Pesquisar cartas"}
                </button>
              </form>
              <p className="card-library-help">
                A busca externa depende do provedor configurado na API. Se a
                pesquisa for muito ampla, use um nome mais específico ou combine
                nome e código.
              </p>
              {state.external && !state.loading && (
                <>
                  <p className="card-library-count">
                    {state.external.length} cartas retornadas nesta pesquisa.
                  </p>
                  {!state.external.length && (
                    <p className="card-library-empty">
                      Nenhuma carta encontrada. Tente outro nome ou código.
                    </p>
                  )}
                  <ul className="card-library-grid">
                    {state.externalRows.map((card) => (
                      <li className="card-library-item" key={card.externalId}>
                        <CardArt card={card} />
                        <CardSummary card={card} />
                        <button
                          className="outline"
                          onClick={() => state.review(card)}
                        >
                          Revisar {card.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <Pagination
                    page={state.externalPage}
                    totalPages={state.totalExternalPages}
                    disabled={disabled}
                    onChange={state.changeExternalPage}
                  />
                </>
              )}
            </>
          )}
          {state.loading && (
            <p className="card-library-loading" role="status" aria-busy="true">
              {state.loading === "detail"
                ? "Carregando carta…"
                : state.loading === "search"
                  ? "Consultando cartas na API Pokémon…"
                  : "Carregando biblioteca…"}
            </p>
          )}
        </>
      )}
    </section>
  );
}
