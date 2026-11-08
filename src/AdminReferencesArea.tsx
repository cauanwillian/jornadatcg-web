import { useId } from "react";
import { AdminReferenceForm } from "./AdminReferenceForm";
import { useAdminReferences } from "./useAdminReferences";
import type { ReferenceKind } from "./admin-references";

const kinds: { kind: ReferenceKind; label: string; singular: string }[] = [
  { kind: "category", label: "Categorias", singular: "categoria" },
  { kind: "condition", label: "Condições", singular: "condição" },
  { kind: "language", label: "Idiomas", singular: "idioma" },
];
export function AdminReferencesArea({ isCurrentSession, onBusyChange, onChanged }: {
  isCurrentSession: () => boolean; onBusyChange: (busy: boolean) => void; onChanged?: () => void;
}) {
  const state = useAdminReferences(isCurrentSession, onBusyChange, onChanged);
  const id = useId();
  if (!isCurrentSession()) return null;
  if (state.denied) return <p className="error" role="alert">Acesso restrito a administradores. Entre com uma conta autorizada.</p>;
  const selected = kinds.find(item => item.kind === state.kind)!;
  return <section className="references-area" aria-label="Cadastros da loja">
    <p className="references-help">Cadastre as categorias, as condições das cartas e os idiomas usados nos anúncios. A lista mostra somente cadastros ativos.</p>
    {state.error && <p className="error" role="alert">{state.error}</p>}
    {state.notice && <p className="auth-success" role="status">{state.notice}</p>}
    {state.busy && <p className="references-loading" role="status">Salvando cadastro e conferindo a lista…</p>}
    {state.pending && <section className="references-uncertain" aria-label="Conferir cadastro anterior">
      <p className="shipping-note">O cadastro anterior pode ter sido concluído. Atualize a lista e confira a opção antes de cadastrar novamente. Se fechar a tela ou usar outra aba, consulte os cadastros antes de repetir com outro identificador.</p>
      <p>Identificador da tentativa: <strong>{state.pending.identifier}</strong>.</p>
      {state.reviewReady && !state.blocked && <>
        <label className="checkbox-label" htmlFor={`${id}-review`}><input id={`${id}-review`} type="checkbox" checked={state.reviewed} disabled={state.busy || state.loading} onChange={event => state.setReviewed(event.target.checked)} />Conferi os cadastros e a opção que desejo criar ainda não existe</label>
        <button className="outline" disabled={!state.reviewed || state.busy || state.loading} onClick={state.releaseCreate}>Liberar novo cadastro</button>
      </>}
    </section>}
    <nav className="references-tabs" aria-label="Tipos de cadastro">
      {kinds.map(item => <button key={item.kind} type="button" aria-pressed={state.kind === item.kind} disabled={state.busy || state.creating} onClick={() => state.changeKind(item.kind)}>{item.label}</button>)}
    </nav>
    {state.creating ? <AdminReferenceForm key={state.kind} kind={state.kind} busy={state.busy} isCurrentSession={isCurrentSession} onSubmit={state.save} onCancel={state.cancel} /> : <>
      <div className="references-toolbar">
        <h3>{selected.label}</h3>
        <div className="button-row"><button className="outline" disabled={state.busy || state.loading} onClick={state.refresh}>Atualizar cadastros</button><button className="primary" disabled={state.busy || state.loading || state.blocked || !state.options || Boolean(state.pending)} onClick={state.openCreate}>Cadastrar {selected.singular}</button></div>
      </div>
      <label className="references-filter" htmlFor={`${id}-filter`}>Filtrar por nome ou identificador<input id={`${id}-filter`} value={state.filter} maxLength={120} disabled={state.busy || state.loading || !state.options} onChange={event => state.changeFilter(event.target.value)} /></label>
      {state.loading && <p className="references-loading" role="status" aria-busy="true">Carregando cadastros…</p>}
      {state.options && !state.loading && <>
        <p className="references-count">{state.filteredTotal} de {state.total} cadastros ativos nesta lista.</p>
        {!state.rows.length && <p className="references-empty">{state.filter.trim() ? "Nenhum cadastro corresponde ao filtro." : "Nenhum cadastro ativo nesta lista. Cadastre uma opção para usá-la nos anúncios."}</p>}
        <ul className="references-list">{state.rows.map(row => <li className="references-item" key={row.id}><div className="references-item-heading"><h4>{row.name}</h4><span className="references-identifier">{"slug" in row ? row.slug : row.code}</span></div>{"description" in row && row.description && <p>{row.description}</p>}</li>)}</ul>
        {state.totalPages > 1 && <nav className="references-pagination" aria-label="Páginas dos cadastros"><button className="outline" disabled={state.busy || state.page <= 1} onClick={() => state.changePage(state.page - 1)}>Anterior</button><span>Página {state.page} de {state.totalPages}</span><button className="outline" disabled={state.busy || state.page >= state.totalPages} onClick={() => state.changePage(state.page + 1)}>Próxima</button></nav>}
      </>}
      <p className="references-help">Os identificadores de categoria e os códigos de condição e idioma são exclusivos. O nome da categoria também é exclusivo. Cadastros inativos continuam reservando esses dados, mesmo sem aparecer na lista.</p>
    </>}
  </section>;
}
