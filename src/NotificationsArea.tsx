import {
  useNotifications,
  type JourneyNotification,
  type NotificationTarget,
} from "./notifications";

const date = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "medium",
  timeStyle: "short",
});

function NotificationItem({
  item,
  disabled,
  onOpen,
}: {
  item: JourneyNotification;
  disabled: boolean;
  onOpen: (target: NotificationTarget) => Promise<void>;
}) {
  return (
    <li className="notification-item">
      <article>
        <div className="notification-meta">
          <span className="notification-kind">
            {item.target.type === "order" ? "Pedido" : "Envio"}
          </span>
          <time dateTime={item.occurredAt}>
            {date.format(new Date(item.occurredAt))}
          </time>
        </div>
        <h4>{item.title}</h4>
        <p>{item.message}</p>
        <button
          className="outline"
          disabled={disabled}
          onClick={() => void onOpen(item.target)}
        >
          {item.target.type === "order"
            ? `Ver pedido${item.orderNumber ? ` #${item.orderNumber}` : ""}`
            : "Ver envio"}
        </button>
      </article>
    </li>
  );
}

export function NotificationsArea({
  isCurrentSession,
  onOpenTarget,
}: {
  isCurrentSession: () => boolean;
  onOpenTarget: (target: NotificationTarget) => Promise<void>;
}) {
  const state = useNotifications(isCurrentSession, onOpenTarget);
  if (!isCurrentSession()) return null;
  return (
    <section
      className="notifications-area"
      aria-label="Notificações da sua conta"
    >
      <div className="notification-toolbar">
        <h3>Atualizações da sua conta</h3>
        <button
          className="outline"
          disabled={state.opening || state.denied}
          onClick={state.refresh}
        >
          Atualizar notificações
        </button>
      </div>
      <p className="notification-help">
        Veja os marcos dos seus pedidos e envios, dos mais recentes para os mais
        antigos. Estas atualizações são um histórico. Abra o detalhe para
        consultar a situação atual.
      </p>
      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {state.opening && (
        <p className="notification-loading" role="status">
          Abrindo detalhe…
        </p>
      )}
      {state.loading && (
        <p className="notification-loading" role="status" aria-busy="true">
          Carregando notificações…
        </p>
      )}
      {state.page && (
        <>
          {!state.page.items.length && !state.loading && (
            <p className="notification-empty" role="status">
              Você ainda não tem atualizações. Os marcos dos seus pedidos e
              envios aparecerão aqui.
            </p>
          )}
          <ol className="notification-list">
            {state.page.items.map((item) => (
              <NotificationItem
                key={item.id}
                item={item}
                disabled={state.loading || state.opening || state.denied}
                onOpen={state.openTarget}
              />
            ))}
          </ol>
          {state.page.hasMore && (
            <button
              className="outline notification-more"
              disabled={state.loading || state.opening || state.denied}
              onClick={state.loadMore}
            >
              Carregar mais notificações
            </button>
          )}
        </>
      )}
    </section>
  );
}
