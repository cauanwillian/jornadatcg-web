import { useEffect, useId, useRef } from "react";
import { AddressForm } from "./AddressForm";
import { formatAddressZip } from "./addresses";
import type { Address } from "./ShippingAddresses";
import { useAddresses } from "./useAddresses";

function AddressText({ address }: { address: Address }) {
  return (
    <address className="address-preview">
      <strong>{address.recipientName}</strong>
      <br />
      {address.street}, {address.number}
      {address.complement ? ` · ${address.complement}` : ""}
      <br />
      {address.neighborhood} · {address.city}/{address.state}
      <br />
      CEP {formatAddressZip(address.zipCode)}
    </address>
  );
}
function RemovalReview({
  address,
  busy,
  onRemove,
  onCancel,
}: {
  address: Address;
  busy: boolean;
  onRemove: () => Promise<void>;
  onCancel: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <section
      className="addresses-review"
      aria-label="Conferir remoção do endereço"
    >
      <h3 ref={heading} tabIndex={-1}>
        Remover endereço
      </h3>
      <AddressText address={address} />
      <p>
        Este endereço será removido da sua conta. Solicitações de envio já
        criadas mantêm o endereço registrado na ocasião.
      </p>
      {address.isDefault && (
        <p className="shipping-note">
          Este é o endereço principal. Após a remoção, o endereço restante salvo
          há mais tempo será o principal, se houver.
        </p>
      )}
      <div className="button-row">
        <button
          className="primary"
          disabled={busy}
          onClick={() => void onRemove()}
        >
          {busy ? "Removendo endereço…" : "Confirmar remoção"}
        </button>
        <button className="outline" disabled={busy} onClick={onCancel}>
          Cancelar remoção
        </button>
      </div>
    </section>
  );
}

export function AddressesArea({
  isCurrentSession,
  onBusyChange,
}: {
  isCurrentSession: () => boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const state = useAddresses(isCurrentSession, onBusyChange);
  const reviewId = useId();
  if (!isCurrentSession()) return null;
  if (state.denied)
    return (
      <p className="error" role="alert">
        Não foi possível acessar os endereços desta conta. Entre novamente.
      </p>
    );
  const disabled =
    state.busy || state.loading || state.checking || state.blocked;
  return (
    <section className="addresses-area" aria-label="Meus endereços">
      <p className="addresses-help">
        Gerencie os endereços para suas próximas solicitações de envio.
        Alterações e remoções não modificam envios já solicitados.
      </p>
      {state.error && (
        <p role="alert" className="error">
          {state.error}
        </p>
      )}
      {state.notice && (
        <p role="status" className="auth-success">
          {state.notice}
        </p>
      )}
      {state.createReview && (
        <section
          className="addresses-uncertain"
          aria-label="Conferência de cadastro incerto"
        >
          <p className="shipping-note">
            Um cadastro anterior pode ter sido concluído. Atualize a lista e
            confira os endereços antes de cadastrar novamente. Se fechar esta
            tela ou trocar de aba, consulte a lista antes de repetir o cadastro.
          </p>
          {state.createReviewReady && !state.blocked && (
            <>
              <label className="checkbox-label" htmlFor={reviewId}>
                <input
                  id={reviewId}
                  type="checkbox"
                  checked={state.createReviewed}
                  disabled={state.busy || state.loading}
                  onChange={(event) =>
                    state.setCreateReviewed(event.target.checked)
                  }
                />
                Conferi a lista e o endereço que desejo cadastrar ainda não
                existe
              </label>
              <button
                className="outline"
                disabled={!state.createReviewed || state.busy || state.loading}
                onClick={state.releaseCreate}
              >
                Liberar novo cadastro
              </button>
            </>
          )}
        </section>
      )}
      {state.view ? (
        state.view.type === "remove" ? (
          <RemovalReview
            key={`${state.view.address.id}:${state.view.address.updatedAt}`}
            address={state.view.address}
            busy={state.busy}
            onRemove={state.remove}
            onCancel={state.cancel}
          />
        ) : (
          <AddressForm
            key={
              state.view.type === "edit"
                ? `${state.view.address.id}:${state.view.address.updatedAt}`
                : "new"
            }
            initial={
              state.view.type === "edit" ? state.view.address : undefined
            }
            busy={state.busy}
            isCurrentSession={isCurrentSession}
            onSubmit={state.save}
            onCancel={state.cancel}
          />
        )
      ) : (
        <>
          <div className="addresses-toolbar">
            <h3>Endereços salvos</h3>
            <div className="button-row">
              <button
                className="outline"
                disabled={state.busy || state.loading || state.checking}
                onClick={state.refresh}
              >
                Atualizar endereços
              </button>
              <button
                className="primary"
                disabled={
                  disabled ||
                  state.createReview ||
                  !state.addresses ||
                  state.addresses.length >= 20
                }
                onClick={state.openCreate}
              >
                Cadastrar endereço
              </button>
            </div>
          </div>
          {state.loading && (
            <p className="addresses-loading" role="status" aria-busy="true">
              Carregando endereços…
            </p>
          )}
          {state.checking && (
            <div className="addresses-loading">
              <p role="status">Consultando endereço…</p>
              <button
                className="clear"
                disabled={state.busy}
                onClick={state.cancel}
              >
                Cancelar consulta
              </button>
            </div>
          )}
          {!state.loading && state.addresses?.length === 0 && (
            <p className="addresses-empty">
              Você ainda não tem endereços salvos. Cadastre um para receber suas
              compras acumuladas.
            </p>
          )}
          {state.addresses && (
            <>
              <p className="addresses-count">
                {state.addresses.length} de 20 endereços cadastrados. O primeiro
                cadastro será o principal.
              </p>
              {state.addresses.length >= 20 && (
                <p className="shipping-note">
                  Você atingiu o limite de 20 endereços. Remova um endereço que
                  não usa antes de cadastrar outro.
                </p>
              )}
              <div className="addresses-list">
                {state.addresses.map((address) => (
                  <article className="addresses-item" key={address.id}>
                    <div className="addresses-item-heading">
                      <h4>{address.label || address.recipientName}</h4>
                      {address.isDefault && (
                        <span className="addresses-default">Principal</span>
                      )}
                    </div>
                    <AddressText address={address} />
                    <div className="button-row">
                      <button
                        className="outline"
                        aria-label={`Editar endereço ${address.label || address.recipientName}, ${address.street}, ${address.number}`}
                        disabled={disabled}
                        onClick={() =>
                          void state.openExisting(address.id, "edit")
                        }
                      >
                        Editar endereço
                      </button>
                      <button
                        className="clear"
                        aria-label={`Remover endereço ${address.label || address.recipientName}, ${address.street}, ${address.number}`}
                        disabled={disabled}
                        onClick={() =>
                          void state.openExisting(address.id, "remove")
                        }
                      >
                        Remover endereço
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
