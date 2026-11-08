import { useAdminShipments } from "./useAdminShipments";
import { AdminShipmentDetail } from "./AdminShipmentDetail";
import { shipmentStatusText } from "./admin-shipments";

export function ShipmentManagement({
  isCurrentSession,
  onBusyChange,
  initialShipmentId,
}: {
  isCurrentSession: () => boolean;
  onBusyChange: (busy: boolean) => void;
  initialShipmentId?: string;
}) {
  const state = useAdminShipments(
    isCurrentSession,
    onBusyChange,
    initialShipmentId,
  );
  if (state.denied)
    return (
      <p className="error" role="alert">
        Acesso restrito a administradores. Entre com uma conta autorizada.
      </p>
    );
  return (
    <section className="admin-shipments" aria-label="Gestão de envios">
      <p className="muted">
        Acompanhe a separação, as etiquetas e a postagem das compras acumuladas.
      </p>
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
      {state.selectedId ? (
        <>
          <div className="shipment-toolbar">
            <button
              className="clear"
              disabled={state.busy}
              onClick={state.back}
            >
              Voltar aos envios
            </button>
            <button
              className="outline"
              disabled={state.busy || state.checking}
              onClick={state.refreshDetail}
            >
              Atualizar envio
            </button>
          </div>
          {state.checking && <p role="status">Consultando envio…</p>}
          {state.busy && <p role="status">Operação em andamento…</p>}
          {state.detail && (
            <AdminShipmentDetail
              key={`${state.detail.id}:${state.detailVersion}`}
              detail={state.detail}
              busy={state.busy}
              blocked={state.blocked}
              checking={state.checking}
              printUrl={state.printUrl}
              run={state.run}
              isCurrentSession={isCurrentSession}
            />
          )}
        </>
      ) : (
        <>
          <div className="shipment-toolbar">
            <h3>Envios em andamento</h3>
            <button
              className="outline"
              disabled={state.busy || state.loading}
              onClick={state.refreshQueue}
            >
              Atualizar envios
            </button>
          </div>
          <p className="muted">
            A fila mostra envios em preparação, prontos para postagem e
            postados, dos mais antigos para os mais recentes. Entregues e
            cancelados deixam esta fila.
          </p>
          {state.loading ? (
            <div className="shipment-loading" role="status" aria-busy="true">
              Carregando envios…
            </div>
          ) : (
            state.queue && (
              <>
                <p className="muted">
                  {state.queue.total} envios em andamento.
                </p>
                {!state.queue.items.length && (
                  <p>
                    Nenhum envio nesta página. As solicitações aparecem após a
                    confirmação do pagamento do frete.
                  </p>
                )}
                <div className="shipment-queue">
                  {state.queue.items.map((shipment) => (
                    <article className="shipment-queue-row" key={shipment.id}>
                      <div>
                        <strong>Envio {shipment.id.slice(0, 8)}</strong>
                        <span className="order-status">
                          {shipmentStatusText(shipment.status)}
                        </span>
                        <p className="shipment-identifier">{shipment.id}</p>
                        <p>
                          {shipment.items.reduce(
                            (sum, item) => sum + item.quantity,
                            0,
                          )}{" "}
                          cartas ·{" "}
                          {shipment.packedAt
                            ? "Embalagem conferida"
                            : "Aguardando conferência"}
                        </p>
                        <small>
                          {shipment.items
                            .slice(0, 3)
                            .map(
                              (item) =>
                                `${item.quantity}× ${item.orderItem.cardName}`,
                            )
                            .join(" · ")}
                          {shipment.items.length > 3 ? " · outros itens" : ""}
                        </small>
                        {shipment.trackingCode && (
                          <p>Rastreio: {shipment.trackingCode}</p>
                        )}
                      </div>
                      <button
                        className="outline"
                        disabled={state.busy}
                        aria-label={`Gerenciar envio ${shipment.id}`}
                        onClick={() => state.open(shipment.id)}
                      >
                        Gerenciar envio
                      </button>
                    </article>
                  ))}
                </div>
                <nav
                  className="shipping-pagination"
                  aria-label="Páginas dos envios"
                >
                  <button
                    disabled={state.busy || state.loading || state.page <= 1}
                    onClick={() => state.changePage(state.page - 1)}
                  >
                    Anterior
                  </button>
                  <span>
                    Página {state.page} de{" "}
                    {Math.max(1, Math.ceil(state.queue.total / 12))}
                  </span>
                  <button
                    disabled={
                      state.busy ||
                      state.loading ||
                      state.page * 12 >= state.queue.total
                    }
                    onClick={() => state.changePage(state.page + 1)}
                  >
                    Próxima
                  </button>
                </nav>
              </>
            )
          )}
        </>
      )}
    </section>
  );
}
