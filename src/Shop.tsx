import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  lazy,
  Suspense,
} from "react";
import type { ReactNode, FormEvent } from "react";
import {
  authorized,
  invalidateSession,
  login,
  logout,
  refresh,
  subscribe,
} from "./session";
import type { User } from "./session";
import { money } from "./api";
import { Checkout } from "./Checkout";
import { MyOrders } from "./MyOrdersArea";
import { Shipping } from "./ShippingArea";
import { Registration } from "./RegistrationForm";
import { ForgotPassword, ResetPassword } from "./PasswordRecovery";
import type { RecoveryLink } from "./recovery-link";
import { AdminPanel } from "./AdminArea";
import { BannerPanel } from "./AdminBannersArea";
import { ShipmentManagement } from "./AdminShipmentsArea";
import { NotificationsArea } from "./NotificationsArea";
import { AddressesArea } from "./AddressesArea";
import { AdminReferencesArea } from "./AdminReferencesArea";
import { AdminCardsArea } from "./AdminCardsArea";
import { AdminOrdersArea } from "./AdminOrdersArea";
import { AdminInventoryArea } from "./AdminInventoryArea";
const StockMovementsArea = lazy(() =>
  import("./StockMovementsArea").then((module) => ({
    default: module.StockMovementsArea,
  })),
);
import { loadNotificationOrder } from "./notification-order";
import type { Order } from "./purchase";
import { loadAttempt } from "./purchase";
interface Cart {
  items: {
    productId: string;
    quantity: number;
    availableQuantity: number;
    available: boolean;
    card: { name: string };
    unitPrice: string;
    subtotal: string;
  }[];
  summary: { totalQuantity: number; subtotal: string };
}
const empty: Cart = {
  items: [],
  summary: { totalQuantity: 0, subtotal: "0.00" },
};
function hasPendingCheckout(userId: string): boolean {
  try {
    return loadAttempt(userId) !== null;
  } catch {
    // The confirmation screen explains storage errors and blocks a new key.
    return true;
  }
}
interface Shop {
  user: User | null;
  busy: boolean;
  add: (id: string, quantity?: number) => Promise<void>;
  openCart: () => void;
  openAccount: () => void;
  openNotifications: () => void;
  cart: Cart;
}
const Context = createContext<Shop | null>(null);
function useShop() {
  const value = useContext(Context);
  if (!value) throw Error("Shop provider missing");
  return value;
}
function Modal({
  children,
  title,
  close,
  busy = false,
  wide = false,
  management = false,
}: {
  children: ReactNode;
  title: string;
  close: () => void;
  busy?: boolean;
  wide?: boolean;
  management?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      className={`shop-dialog${wide ? " shipping-dialog" : ""}${management ? " admin-dialog" : ""}`}
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <button
        className="close"
        aria-label="Fechar"
        disabled={busy}
        onClick={close}
      >
        ×
      </button>
      <h2 id={titleId}>{title}</h2>
      {children}
    </dialog>
  );
}
export function ShopProvider({
  children,
  recovery,
}: {
  children: ReactNode;
  recovery?: RecoveryLink;
}) {
  const [user, setUser] = useState<User | null>(null);
  const [cart, setCart] = useState<Cart>(empty);
  const [busy, setBusy] = useState(false);
  const [flowBusy, setFlowBusy] = useState(false);
  const flowMutation = useRef(false);
  const lock = useRef(false);
  const cartRevision = useRef(0);
  const identity = useRef<string | undefined>(undefined);
  const role = useRef<string | undefined>(undefined);
  const sessionRevision = useRef(0);
  const [sessionEpoch, setSessionEpoch] = useState(0);
  const notificationRequest = useRef<AbortController | null>(null);

  const [panel, setPanel] = useState<
    | "login"
    | "register"
    | "forgot-password"
    | "reset-password"
    | "cart"
    | "account"
    | "checkout"
    | "orders"
    | "shipping"
    | "admin"
    | "admin-banners"
    | "admin-shipments"
    | "admin-references"
    | "admin-cards"
    | "admin-orders"
    | "admin-inventory"
    | "admin-stock-history"
    | "notifications"
    | "addresses"
    | null
  >(recovery?.present ? "reset-password" : null);
  const [recoveryToken, setRecoveryToken] = useState(recovery?.token ?? null);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [selectedShipmentId, setSelectedShipmentId] = useState<
    string | undefined
  >();
  const [selectedAdminShipmentId, setSelectedAdminShipmentId] =
    useState<string>();
  const [selectedAdminProductId, setSelectedAdminProductId] =
    useState<string>();
  const [historyProductId, setHistoryProductId] = useState<string>();
  const [pendingCheckout, setPendingCheckout] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  useEffect(() => {
    const off = subscribe((u) => {
      if (identity.current !== u?.id || role.current !== u?.role) {
        sessionRevision.current++;
        setSessionEpoch(sessionRevision.current);
        notificationRequest.current?.abort();
        notificationRequest.current = null;
        cartRevision.current++;
        setCart(empty);
        setSelectedOrder(null);
        setSelectedShipmentId(undefined);
        setSelectedAdminShipmentId(undefined);
        setSelectedAdminProductId(undefined);
        setHistoryProductId(undefined);
        setPendingCheckout(false);
        flowMutation.current = false;
        setFlowBusy(false);
      }
      identity.current = u?.id;
      role.current = u?.role;
      setUser(u);
      if (!u) {
        setCart(empty);
        setPanel((current) =>
          current === "register" ||
          current === "forgot-password" ||
          current === "reset-password"
            ? current
            : current
              ? "login"
              : null,
        );
      } else {
        setPanel((current) =>
          current === "register" ||
          ((current === "admin" ||
            current === "admin-banners" ||
            current === "admin-shipments" ||
            current === "admin-references" ||
            current === "admin-cards" ||
            current === "admin-orders" ||
            current === "admin-inventory" ||
            current === "admin-stock-history") &&
            u.role !== "ADMIN")
            ? "account"
            : current,
        );
      }
    });
    void refresh().catch(() => {});
    return () => {
      off();
      notificationRequest.current?.abort();
      notificationRequest.current = null;
    };
  }, []);
  const userId = user?.id;
  const renderedSession = sessionEpoch;
  function openStockHistory(productId: string) {
    if (
      !user ||
      identity.current !== user.id ||
      role.current !== "ADMIN" ||
      sessionRevision.current !== renderedSession ||
      lock.current ||
      flowMutation.current ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        productId,
      )
    )
      return;
    setHistoryProductId(productId);
    setPanel("admin-stock-history");
  }
  useEffect(() => {
    if (!userId) return;
    let active = true;
    const started = cartRevision.current;
    authorized<Cart>("/cart")
      .then((c) => {
        if (active && cartRevision.current === started) setCart(c);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [userId]);
  async function action(work: () => Promise<void>) {
    if (lock.current || flowMutation.current) return;
    lock.current = true;
    cartRevision.current++;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha na operação.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function add(id: string, quantity = 1) {
    if (!user) {
      setError("Entre na sua conta para adicionar cartas.");
      setPanel("login");
      return;
    }
    await action(async () => {
      const owner = identity.current;
      if (!owner || owner !== user.id)
        throw new Error("Sua sessão mudou. Abra o carrinho novamente.");
      const fresh = await authorized<Cart>("/cart");
      if (identity.current !== owner)
        throw new Error("Sua sessão mudou. Abra o carrinho novamente.");
      const qty =
        (fresh.items.find((i) => i.productId === id)?.quantity ?? 0) + quantity;
      const result = await authorized<Cart>(`/cart/items/${id}`, {
        method: "PUT",
        body: JSON.stringify({ quantity: qty }),
      });
      setCart(result);
      setNotice("Carta adicionada ao carrinho.");
    });
  }
  async function change(id: string, quantity: number) {
    await action(async () => {
      const c = await authorized<Cart>(
        `/cart/items/${id}`,
        quantity === 0
          ? { method: "DELETE" }
          : { method: "PUT", body: JSON.stringify({ quantity }) },
      );
      setCart(c);
    });
  }
  async function signIn(e: FormEvent) {
    e.preventDefault();
    await action(async () => {
      const loggedIn = await login(email, password);
      setPassword("");
      if (identity.current !== loggedIn.user.id)
        throw new Error("Sua sessão mudou. Entre novamente.");
      setPendingCheckout(hasPendingCheckout(loggedIn.user.id));
      setPanel("cart");
      setCart(await authorized<Cart>("/cart"));
    });
  }
  function open(value: "cart" | "account" | "notifications") {
    if (lock.current || flowMutation.current) return;
    setError("");
    setAuthNotice("");
    if (user && value === "cart")
      setPendingCheckout(hasPendingCheckout(user.id));
    setPanel(user ? value : "login");
    if (!user && value === "notifications")
      setAuthNotice("Entre para acompanhar seus pedidos e envios.");
    if (user && value === "cart")
      void action(async () => {
        setCart(await authorized<Cart>("/cart"));
      });
  }
  async function openNotificationTarget(target: {
    type: "order" | "shipment";
    id: string;
  }) {
    if (
      lock.current ||
      flowMutation.current ||
      !user ||
      identity.current !== user.id ||
      panel !== "notifications"
    )
      return;
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        target.id,
      )
    )
      throw new Error("Destino indisponível.");
    if (target.type === "shipment") {
      setSelectedShipmentId(target.id);
      setError("");
      setPanel("shipping");
      return;
    }
    if (target.type !== "order") throw new Error("Destino indisponível.");
    const controller = new AbortController();
    const started = sessionRevision.current;
    notificationRequest.current = controller;
    flowMutation.current = true;
    setFlowBusy(true);
    try {
      const order = await loadNotificationOrder(target.id, controller);
      if (
        notificationRequest.current !== controller ||
        sessionRevision.current !== started ||
        identity.current !== user.id
      )
        return;
      setSelectedOrder(order);
      setError("");
      setPanel("checkout");
    } finally {
      if (notificationRequest.current === controller) {
        notificationRequest.current = null;
        flowMutation.current = false;
        setFlowBusy(false);
      }
    }
  }
  return (
    <Context.Provider
      value={{
        user,
        busy: busy || flowBusy,
        add,
        cart,
        openCart: () => open("cart"),
        openAccount: () => open("account"),
        openNotifications: () => open("notifications"),
      }}
    >
      {children}
      {notice && (
        <div className="notice" role="status">
          {notice}
          <button onClick={() => setNotice("")}>Fechar</button>
        </div>
      )}
      {error && !panel && (
        <div className="notice" role="alert">
          {error}
          <button onClick={() => setError("")}>Fechar</button>
        </div>
      )}
      {panel && (
        <Modal
          busy={busy || flowBusy}
          wide={
            panel === "shipping" ||
            panel === "notifications" ||
            panel === "addresses"
          }
          management={
            panel === "admin" ||
            panel === "admin-banners" ||
            panel === "admin-shipments" ||
            panel === "admin-references" ||
            panel === "admin-cards" ||
            panel === "admin-orders" ||
            panel === "admin-inventory" ||
            panel === "admin-stock-history"
          }
          title={
            panel === "forgot-password"
              ? "Recupere sua senha"
              : panel === "reset-password"
                ? "Defina uma nova senha"
                : panel === "login"
                  ? "Entre na sua jornada"
                  : panel === "register"
                    ? "Crie sua conta"
                    : panel === "cart"
                      ? "Seu carrinho"
                      : panel === "orders"
                        ? "Meus pedidos"
                        : panel === "checkout"
                          ? selectedOrder
                            ? `Pedido #${selectedOrder.orderNumber}`
                            : "Finalizar compra"
                          : panel === "shipping"
                            ? "Compras e envios"
                            : panel === "admin"
                              ? "Gestão de produtos"
                              : panel === "admin-banners"
                                ? "Gestão de banners"
                                : panel === "admin-shipments"
                                  ? "Gestão de envios"
                                  : panel === "admin-orders"
                                    ? "Pedidos e vendas"
                                    : panel === "admin-inventory"
                                      ? "Visão de estoque"
                                      : panel === "admin-stock-history"
                                        ? "Histórico de estoque"
                                        : panel === "admin-cards"
                                          ? "Biblioteca de cartas"
                                          : panel === "admin-references"
                                            ? "Cadastros da loja"
                                            : panel === "notifications"
                                              ? "Notificações"
                                              : panel === "addresses"
                                                ? "Meus endereços"
                                                : "Minha conta"
          }
          close={() => {
            if (!lock.current && !flowMutation.current) {
              setPanel(null);
              setPassword("");
              setError("");
              setAuthNotice("");
              setRecoveryToken(null);
            }
          }}
        >
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {panel === "register" ? (
            <Registration
              initialEmail={email}
              onBusyChange={(value) => {
                flowMutation.current = value;
                setFlowBusy(value);
              }}
              onLogin={(registeredEmail, created) => {
                setEmail(registeredEmail);
                setPassword("");
                setError("");
                setAuthNotice(
                  created
                    ? "Conta criada! Entre com seu e-mail e senha para continuar."
                    : "",
                );
                setPanel("login");
              }}
            />
          ) : panel === "forgot-password" ? (
            <ForgotPassword
              key={`forgot:${renderedSession}`}
              initialEmail={email}
              isCurrentSession={() =>
                sessionRevision.current === renderedSession
              }
              onBusyChange={(value) => {
                if (sessionRevision.current !== renderedSession) return;
                flowMutation.current = value;
                setFlowBusy(value);
              }}
              onLogin={() => {
                if (
                  sessionRevision.current !== renderedSession ||
                  flowMutation.current
                )
                  return;
                setPanel("login");
                setError("");
                setPassword("");
              }}
            />
          ) : panel === "reset-password" ? (
            <ResetPassword
              key={`reset:${renderedSession}`}
              token={recoveryToken}
              isCurrentSession={() =>
                sessionRevision.current === renderedSession
              }
              onBusyChange={(value) => {
                if (sessionRevision.current !== renderedSession) return;
                flowMutation.current = value;
                setFlowBusy(value);
              }}
              onReset={() => {
                if (sessionRevision.current !== renderedSession) return;
                invalidateSession();
                setRecoveryToken(null);
                setPassword("");
                setPanel("login");
                setError("");
                setAuthNotice(
                  "Senha redefinida. Entre novamente com sua nova senha.",
                );
              }}
              onLogin={() => {
                if (
                  sessionRevision.current !== renderedSession ||
                  flowMutation.current
                )
                  return;
                setRecoveryToken(null);
                setPassword("");
                setError("");
                setPanel("login");
              }}
            />
          ) : panel === "login" ? (
            <form onSubmit={signIn}>
              {authNotice && (
                <p className="auth-success" role="status">
                  {authNotice}
                </p>
              )}
              <p className="muted">
                Use sua conta JornadaTCG para guardar suas cartas no carrinho.
              </p>
              <label>
                E-mail
                <input
                  type="email"
                  autoComplete="username"
                  required
                  disabled={busy}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label>
                Senha
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  disabled={busy}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <button className="primary" disabled={busy}>
                {busy ? "Entrando…" : "Entrar"}
              </button>
              <button
                className="password-recovery-link"
                type="button"
                disabled={busy}
                onClick={() => {
                  setPassword("");
                  setError("");
                  setAuthNotice("");
                  setPanel("forgot-password");
                }}
              >
                Esqueci minha senha
              </button>
              <div className="auth-switch">
                <span>Ainda não tem conta?</span>
                <button
                  type="button"
                  className="clear"
                  disabled={busy}
                  onClick={() => {
                    setError("");
                    setAuthNotice("");
                    setPassword("");
                    setPanel("register");
                  }}
                >
                  Criar conta
                </button>
              </div>
            </form>
          ) : panel === "admin-stock-history" && user?.role === "ADMIN" ? (
            <Suspense fallback={<p role="status">Carregando histórico…</p>}>
              <StockMovementsArea
                key={`${user.id}:${renderedSession}:${historyProductId ?? "all"}`}
                initialProductId={historyProductId}
                isCurrentSession={() =>
                  identity.current === user.id &&
                  role.current === "ADMIN" &&
                  sessionRevision.current === renderedSession
                }
              />
            </Suspense>
          ) : panel === "admin-inventory" && user?.role === "ADMIN" ? (
            <AdminInventoryArea
              key={`${user.id}:${renderedSession}`}
              onOpenHistory={openStockHistory}
              isCurrentSession={() =>
                identity.current === user.id &&
                role.current === "ADMIN" &&
                sessionRevision.current === renderedSession
              }
              onOpenProduct={(id) => {
                if (
                  identity.current !== user.id ||
                  role.current !== "ADMIN" ||
                  sessionRevision.current !== renderedSession ||
                  lock.current ||
                  flowMutation.current ||
                  !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                    id,
                  )
                )
                  return;
                setSelectedAdminProductId(id);
                setPanel("admin");
              }}
            />
          ) : panel === "admin-orders" && user?.role === "ADMIN" ? (
            <AdminOrdersArea
              key={`${user.id}:${renderedSession}`}
              isCurrentSession={() =>
                identity.current === user.id &&
                role.current === "ADMIN" &&
                sessionRevision.current === renderedSession
              }
              onOpenShipment={(id) => {
                if (
                  identity.current !== user.id ||
                  role.current !== "ADMIN" ||
                  sessionRevision.current !== renderedSession ||
                  lock.current ||
                  flowMutation.current ||
                  !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                    id,
                  )
                )
                  return;
                setSelectedAdminShipmentId(id);
                setPanel("admin-shipments");
              }}
            />
          ) : panel === "admin-cards" && user?.role === "ADMIN" ? (
            <AdminCardsArea
              key={`${user.id}:${renderedSession}`}
              isCurrentSession={() =>
                identity.current === user.id &&
                role.current === "ADMIN" &&
                sessionRevision.current === renderedSession
              }
              onBusyChange={(value) => {
                if (
                  identity.current !== user.id ||
                  role.current !== "ADMIN" ||
                  sessionRevision.current !== renderedSession
                )
                  return;
                flowMutation.current = value;
                setFlowBusy(value);
              }}
              onOpenProducts={() => {
                if (
                  identity.current === user.id &&
                  role.current === "ADMIN" &&
                  sessionRevision.current === renderedSession &&
                  !lock.current &&
                  !flowMutation.current
                ) {
                  setSelectedAdminProductId(undefined);
                  setPanel("admin");
                }
              }}
            />
          ) : panel === "admin-references" && user?.role === "ADMIN" ? (
            <AdminReferencesArea
              key={`${user.id}:${renderedSession}`}
              isCurrentSession={() =>
                identity.current === user.id &&
                role.current === "ADMIN" &&
                sessionRevision.current === renderedSession
              }
              onBusyChange={(value) => {
                if (
                  identity.current !== user.id ||
                  role.current !== "ADMIN" ||
                  sessionRevision.current !== renderedSession
                )
                  return;
                flowMutation.current = value;
                setFlowBusy(value);
              }}
              onChanged={() => {
                if (
                  identity.current === user.id &&
                  role.current === "ADMIN" &&
                  sessionRevision.current === renderedSession
                )
                  window.dispatchEvent(new Event("jornada-catalog-changed"));
              }}
            />
          ) : panel === "admin-shipments" && user?.role === "ADMIN" ? (
            <ShipmentManagement
              key={`${user.id}:${renderedSession}:${selectedAdminShipmentId ?? "queue"}`}
              initialShipmentId={selectedAdminShipmentId}
              isCurrentSession={() =>
                identity.current === user.id &&
                role.current === "ADMIN" &&
                sessionRevision.current === renderedSession
              }
              onBusyChange={(value) => {
                if (
                  identity.current !== user.id ||
                  role.current !== "ADMIN" ||
                  sessionRevision.current !== renderedSession
                )
                  return;
                flowMutation.current = value;
                setFlowBusy(value);
              }}
            />
          ) : panel === "admin-banners" && user?.role === "ADMIN" ? (
            <BannerPanel
              key={user.id}
              userId={user.id}
              isCurrentSession={() =>
                identity.current === user.id && role.current === "ADMIN"
              }
              onBusyChange={(value) => {
                flowMutation.current = value;
                setFlowBusy(value);
              }}
              onChanged={() =>
                window.dispatchEvent(new Event("jornada-catalog-changed"))
              }
            />
          ) : panel === "admin" && user?.role === "ADMIN" ? (
            <AdminPanel
              key={`${user.id}:${renderedSession}:${selectedAdminProductId ?? "list"}`}
              userId={user.id}
              initialProductId={selectedAdminProductId}
              onOpenHistory={openStockHistory}
              isCurrentSession={() =>
                identity.current === user.id &&
                role.current === "ADMIN" &&
                sessionRevision.current === renderedSession
              }
              onBusyChange={(value) => {
                if (
                  identity.current !== user.id ||
                  role.current !== "ADMIN" ||
                  sessionRevision.current !== renderedSession
                )
                  return;
                flowMutation.current = value;
                setFlowBusy(value);
              }}
              onChanged={() => {
                if (
                  identity.current === user.id &&
                  role.current === "ADMIN" &&
                  sessionRevision.current === renderedSession
                )
                  window.dispatchEvent(new Event("jornada-catalog-changed"));
              }}
            />
          ) : panel === "checkout" && user ? (
            <Checkout
              key={`${user.id}:${selectedOrder?.id ?? "cart"}`}
              userId={user.id}
              subtotal={cart.summary.subtotal}
              canCheckout={
                cart.items.length > 0 &&
                cart.items.every((item) => item.available)
              }
              initialOrder={selectedOrder ?? undefined}
              onReviewCart={() => open("cart")}
              isCurrentSession={() => identity.current === user.id}
              onBusyChange={(value) => {
                flowMutation.current = value;
                setFlowBusy(value);
              }}
              onCreated={() => {
                if (identity.current !== user.id) return;
                setPendingCheckout(false);
                cartRevision.current++;
                const started = cartRevision.current;
                setCart(empty);
                void authorized<Cart>("/cart")
                  .then((fresh) => {
                    if (cartRevision.current === started) setCart(fresh);
                  })
                  .catch(() => {});
              }}
            />
          ) : panel === "addresses" && user ? (
            <AddressesArea
              key={`${user.id}:${renderedSession}`}
              isCurrentSession={() =>
                identity.current === user.id &&
                sessionRevision.current === renderedSession
              }
              onBusyChange={(value) => {
                if (
                  identity.current !== user.id ||
                  sessionRevision.current !== renderedSession
                )
                  return;
                flowMutation.current = value;
                setFlowBusy(value);
              }}
            />
          ) : panel === "notifications" && user ? (
            <NotificationsArea
              key={user.id}
              isCurrentSession={() => identity.current === user.id}
              onOpenTarget={openNotificationTarget}
            />
          ) : panel === "shipping" && user ? (
            <Shipping
              key={`${user.id}:${selectedShipmentId ?? "available"}`}
              userId={user.id}
              initialShipmentId={selectedShipmentId}
              isCurrentSession={() => identity.current === user.id}
              onBusyChange={(value) => {
                flowMutation.current = value;
                setFlowBusy(value);
              }}
            />
          ) : panel === "orders" && user ? (
            <MyOrders
              key={`${user.id}:${renderedSession}`}
              isCurrentSession={() =>
                identity.current === user.id &&
                sessionRevision.current === renderedSession
              }
              onBusyChange={(value) => {
                if (
                  identity.current !== user.id ||
                  sessionRevision.current !== renderedSession
                )
                  return;
                flowMutation.current = value;
                setFlowBusy(value);
              }}
              onChanged={() => {
                if (
                  identity.current === user.id &&
                  sessionRevision.current === renderedSession
                )
                  window.dispatchEvent(new Event("jornada-catalog-changed"));
              }}
              onOpen={(order) => {
                if (
                  identity.current !== user.id ||
                  sessionRevision.current !== renderedSession ||
                  lock.current ||
                  flowMutation.current
                )
                  return;
                setSelectedOrder(order);
                setPanel("checkout");
              }}
            />
          ) : panel === "account" ? (
            <>
              <p>{user?.name}</p>
              <p className="muted">{user?.email}</p>
              {user?.role === "ADMIN" && (
                <>
                  <button
                    className="outline account-orders"
                    onClick={() => setPanel("admin-orders")}
                  >
                    Pedidos e vendas
                  </button>
                  <button
                    className="outline account-orders"
                    onClick={() => setPanel("admin-inventory")}
                  >
                    Visão de estoque
                  </button>
                  <button
                    className="outline account-orders"
                    onClick={() => {
                      setHistoryProductId(undefined);
                      setPanel("admin-stock-history");
                    }}
                  >
                    Histórico de estoque
                  </button>
                  <button
                    className="outline account-orders"
                    onClick={() => {
                      setSelectedAdminProductId(undefined);
                      setPanel("admin");
                    }}
                  >
                    Gestão de produtos
                  </button>
                  <button
                    className="outline account-orders"
                    onClick={() => setPanel("admin-cards")}
                  >
                    Biblioteca de cartas
                  </button>
                  <button
                    className="outline account-orders"
                    onClick={() => setPanel("admin-references")}
                  >
                    Cadastros da loja
                  </button>
                  <button
                    className="outline account-orders"
                    onClick={() => setPanel("admin-banners")}
                  >
                    Gestão de banners
                  </button>
                  <button
                    className="outline account-orders"
                    onClick={() => {
                      setSelectedAdminShipmentId(undefined);
                      setPanel("admin-shipments");
                    }}
                  >
                    Gestão de envios
                  </button>
                </>
              )}
              <button
                className="outline account-orders"
                onClick={() => setPanel("orders")}
              >
                Meus pedidos
              </button>
              <button
                className="outline account-orders"
                onClick={() => setPanel("addresses")}
              >
                Meus endereços
              </button>
              <button
                className="outline account-orders"
                onClick={() => setPanel("notifications")}
              >
                Notificações
              </button>
              <button
                className="outline account-orders"
                onClick={() => {
                  setSelectedShipmentId(undefined);
                  setPanel("shipping");
                }}
              >
                Compras acumuladas e envios
              </button>
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    await logout();
                    setCart(empty);
                    setPanel(null);
                  })
                }
              >
                Sair da conta
              </button>
            </>
          ) : (
            <>
              <p className="muted">
                O estoque e os preços serão conferidos ao finalizar a compra.
              </p>
              {cart.items.length === 0 ? (
                <p>Seu carrinho está vazio. Explore o catálogo para começar.</p>
              ) : (
                cart.items.map((item) => (
                  <article className="cart-item" key={item.productId}>
                    <h3>{item.card.name}</h3>
                    <p>{money(item.unitPrice)} por unidade</p>
                    {!item.available && (
                      <p className="error">
                        Quantidade indisponível. Ajuste ou remova este item.
                      </p>
                    )}
                    <div className="cart-controls">
                      <button
                        aria-label={`Diminuir ${item.card.name}`}
                        disabled={busy || item.quantity <= 1}
                        onClick={() =>
                          void change(item.productId, item.quantity - 1)
                        }
                      >
                        −
                      </button>
                      <span aria-label="Quantidade">{item.quantity}</span>
                      <button
                        aria-label={`Aumentar ${item.card.name}`}
                        disabled={
                          busy || item.quantity >= item.availableQuantity
                        }
                        onClick={() =>
                          void change(item.productId, item.quantity + 1)
                        }
                      >
                        +
                      </button>
                      <button
                        className="clear"
                        disabled={busy}
                        onClick={() => void change(item.productId, 0)}
                      >
                        Remover
                      </button>
                      <strong>{money(item.subtotal)}</strong>
                    </div>
                  </article>
                ))
              )}
              <div className="cart-total">
                <span>Subtotal</span>
                <strong>{money(cart.summary.subtotal)}</strong>
              </div>
              <button
                className="primary"
                disabled={
                  busy ||
                  (!pendingCheckout &&
                    (cart.items.length === 0 ||
                      cart.items.some((item) => !item.available)))
                }
                onClick={() => {
                  setSelectedOrder(null);
                  setError("");
                  setPanel("checkout");
                }}
              >
                {pendingCheckout ? "Retomar compra" : "Continuar compra"}
              </button>
              <p className="phase-note">
                Você paga as cartas agora e pode acumular compras. O envio e o
                frete são solicitados depois.
              </p>
            </>
          )}
        </Modal>
      )}
    </Context.Provider>
  );
}
export function AccountActions() {
  const shop = useShop();
  return (
    <div className="account-actions">
      <button onClick={shop.openAccount}>
        {shop.user ? shop.user.name.split(" ")[0] : "Entrar"}
      </button>
      <button
        className="notification-trigger"
        aria-label="Notificações"
        onClick={shop.openNotifications}
      >
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
        </svg>
        <span className="notification-trigger-label">Notificações</span>
      </button>
      <button onClick={shop.openCart}>
        Carrinho <span>{shop.cart.summary.totalQuantity}</span>
      </button>
    </div>
  );
}
export function AddButton({
  id,
  quantity = 1,
  available,
}: {
  id: string;
  quantity?: number;
  available: boolean;
}) {
  const shop = useShop();
  return (
    <button
      className="outline"
      disabled={
        !available || shop.busy || !Number.isInteger(quantity) || quantity < 1
      }
      onClick={() => void shop.add(id, quantity)}
    >
      {!available ? "Esgotado" : shop.busy ? "Aguarde…" : "+ carrinho"}
    </button>
  );
}
