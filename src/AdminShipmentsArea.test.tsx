// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ShipmentManagement } from "./AdminShipmentsArea";
import { authorized } from "./session";
import type { AdminShipment, AdminShipmentDetail, AdminShipmentsPage, ShippingLabelDto } from "./admin-shipments";

vi.mock("./session", () => ({ authorized: vi.fn() }));
vi.mock("./AdminLabelForms", () => ({
  CreateLabelForm: ({ busy, onSubmit }: { busy: boolean; onSubmit: (input: { recipientDocument: string; recipientPhone: string }) => Promise<void> }) => (
    <button disabled={busy} onClick={() => void onSubmit({ recipientDocument: "52998224725", recipientPhone: "11999999999" })}>Enviar dados da etiqueta</button>
  ),
  RecoveryLabelForm: ({ busy, onSubmit }: { busy: boolean; onSubmit: (id: string) => Promise<void> }) => (
    <button disabled={busy} onClick={() => void onSubmit("a2e3a12e-8685-4049-b99f-d7f8c644d4be")}>Confirmar recuperação revisada</button>
  ),
  LabelCheckoutForm: ({ busy, cost, onSubmit }: { busy: boolean; cost: string; onSubmit: (cost: string) => Promise<void> }) => (
    <button disabled={busy} onClick={() => void onSubmit(cost)}>Confirmar compra revisada</button>
  ),
}));

const shipmentId = "68a7b7af-18a9-46ab-b44d-a7438cbb5c02";
const secondId = "18a7b7af-18a9-46ab-b44d-a7438cbb5c02";
const remoteId = "a2e3a12e-8685-4049-b99f-d7f8c644d4be";
const timestamp = "2026-10-23T20:00:00.000Z";
const currentSession = () => true;
const noop = () => {};
type Detail = AdminShipmentDetail;

function label(changes: Partial<ShippingLabelDto> = {}): ShippingLabelDto {
  return {
    id: "7bb64fd8-ac67-440f-9b04-eaee73f75c3b",
    shipmentId,
    provider: "melhorenvio:sandbox",
    remoteId,
    status: "PENDING",
    cost: "12.68",
    generatedAt: null,
    createStartedAt: timestamp,
    checkoutStartedAt: null,
    generateStartedAt: null,
    ...changes,
  };
}

function detail(changes: Partial<Detail> = {}): Detail {
  return {
    id: shipmentId,
    userId: "f18a7b7a-18a9-46ab-b44d-a7438cbb5c02",
    status: "PREPARING",
    provider: "melhorenvio:sandbox",
    shippingCost: "12.68",
    address: {
      addressId: "e01b7f30-c1aa-4038-810b-0501fb301ad4",
      recipientName: "Destinatário demonstrativo",
      zipCode: "01001000",
      street: "Rua de demonstração",
      number: "100",
      complement: null,
      neighborhood: "Centro",
      city: "São Paulo",
      state: "SP",
    },
    trackingCode: null,
    shippingPaidAt: timestamp,
    packedAt: null,
    shippedAt: null,
    deliveredAt: null,
    quote: {
      provider: "melhorenvio:sandbox",
      serviceName: "SEDEX",
      serviceCode: "2",
      carrier: "Correios",
      amount: "12.68",
      package: {
        name: "Pequena", height: 3, width: 12, length: 17, weight: 0.15,
        originZipCode: "78556858", destinationZipCode: "01001000", declaredValue: "20.00",
      },
    },
    createdAt: timestamp,
    updatedAt: timestamp,
    items: [{ quantity: 2, orderItem: {
      cardName: "Pikachu demonstrativo",
      cardNumber: "025",
      setName: "Coleção de teste",
      conditionName: "Near Mint",
      languageName: "Português",
      unitPrice: "10.00",
    } }],
    label: null,
    ...changes,
  };
}

function queueRow(value: Detail): AdminShipment {
  return {
    id: value.id,
    userId: value.userId,
    status: value.status,
    packedAt: value.packedAt,
    shippingPaidAt: value.shippingPaidAt,
    trackingCode: value.trackingCode,
    createdAt: value.createdAt,
    items: value.items,
  };
}
function failure(status: number, message = "Falha interna confidencial.") {
  return Object.assign(new Error(message), { status });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function backend() {
  const state = {
    current: detail(),
    other: detail({ id: secondId, address: { ...detail().address!, recipientName: "Outra pessoa demonstrativa" } }),
    rows: null as AdminShipment[] | null,
    total: 1,
    listError: null as Error | null,
    detailError: null as Error | null,
    mutationError: null as Error | null,
    printError: null as Error | null,
    listWait: null as Promise<AdminShipmentsPage> | null,
    detailWait: null as Promise<unknown> | null,
    mutationWait: null as Promise<unknown> | null,
    printResult: { url: "https://sandbox.melhorenvio.com.br/etiquetas/imprimir/teste", mode: "private" } as unknown,
    afterMutation: null as (() => void) | null,
  };
  vi.mocked(authorized).mockImplementation(async (path, request) => {
    const method = request?.method ?? "GET";
    if (path.startsWith("/admin/shipments?") && method === "GET") {
      if (state.listError) throw state.listError;
      const page = Number(new URLSearchParams(path.split("?")[1]).get("page"));
      return state.listWait ?? { items: state.rows ?? [queueRow(state.current)], page, pageSize: 12, total: state.total };
    }
    if (path === `/admin/shipments/${shipmentId}/label/print` && method === "GET") {
      if (state.printError) throw state.printError;
      return state.printResult;
    }
    if ((path === `/admin/shipments/${shipmentId}` || path === `/admin/shipments/${secondId}`) && method === "GET") {
      if (state.detailError) throw state.detailError;
      return state.detailWait ?? structuredClone(path.endsWith(secondId) ? state.other : state.current);
    }
    if (path.startsWith(`/admin/shipments/${shipmentId}/`) && method === "POST") {
      if (state.mutationError) throw state.mutationError;
      if (state.mutationWait) return state.mutationWait;
      state.afterMutation?.();
      return path.endsWith("/pack")
        ? { id: shipmentId, status: state.current.status, packed: true }
        : state.current.label;
    }
    throw new Error(`Rota inesperada: ${method} ${path}`);
  });
  return state;
}
function mutations(suffix?: string) {
  return vi.mocked(authorized).mock.calls.filter(([path, request]) =>
    request?.method === "POST" && (!suffix || path.endsWith(suffix)));
}
function reads(path: string) {
  return vi.mocked(authorized).mock.calls.filter(([url, request]) => url === path && (!request?.method || request.method === "GET"));
}
function mount(props: Partial<Parameters<typeof ShipmentManagement>[0]> = {}) {
  return render(<ShipmentManagement isCurrentSession={currentSession} onBusyChange={noop} {...props} />);
}
async function openDetail(id = shipmentId) {
  fireEvent.click(await screen.findByRole("button", { name: `Gerenciar envio ${id}` }));
  await screen.findByRole("button", { name: "Atualizar envio" });
  await waitFor(() => expect(reads(`/admin/shipments/${id}`)).toHaveLength(1));
}
async function reviewPacking() {
  fireEvent.click(await screen.findByRole("button", { name: "Conferir embalagem" }));
  const confirm = await screen.findByRole("button", { name: "Confirmar embalagem preparada" });
  expect((confirm as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: "Conferi as cartas e a proteção da embalagem" }));
  expect((confirm as HTMLButtonElement).disabled).toBe(false);
}

beforeEach(() => { vi.clearAllMocks(); sessionStorage.clear(); localStorage.clear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("Gestão administrativa de envios", () => {
  it("abre o envio inicial somente por GET, sem carregar a fila, emitir comandos ou consultar impressão", async () => {
    backend();
    const onBusyChange = vi.fn();
    mount({ initialShipmentId: shipmentId, onBusyChange });

    await screen.findByText(/Destinatário demonstrativo/);

    expect(authorized).toHaveBeenCalledTimes(1);
    expect(authorized).toHaveBeenCalledWith(
      `/admin/shipments/${shipmentId}`,
      expect.objectContaining({ method: "GET", cache: "no-store", signal: expect.any(AbortSignal) }),
    );
    expect(reads("/admin/shipments?page=1&pageSize=12")).toHaveLength(0);
    expect(reads(`/admin/shipments/${shipmentId}/label/print`)).toHaveLength(0);
    expect(mutations()).toEqual([]);
    expect(onBusyChange).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
  });

  it("consulta a fila ao voltar de um envio aberto pelo identificador inicial", async () => {
    backend();
    mount({ initialShipmentId: shipmentId });
    await screen.findByText(/Destinatário demonstrativo/);

    fireEvent.click(screen.getByRole("button", { name: "Voltar aos envios" }));

    await screen.findByRole("button", { name: `Gerenciar envio ${shipmentId}` });
    expect(reads(`/admin/shipments/${shipmentId}`)).toHaveLength(1);
    expect(reads("/admin/shipments?page=1&pageSize=12")).toHaveLength(1);
    expect(screen.queryByText(/Destinatário demonstrativo/)).toBeNull();
    expect(mutations()).toEqual([]);
    expect(reads(`/admin/shipments/${shipmentId}/label/print`)).toHaveLength(0);
  });

  it.each(["not-a-uuid", `${shipmentId}/label`])(
    "ignora o identificador inicial inválido %s e consulta somente a fila",
    async (initialShipmentId) => {
      backend();
      mount({ initialShipmentId });

      await screen.findByRole("button", { name: `Gerenciar envio ${shipmentId}` });

      expect(authorized).toHaveBeenCalledTimes(1);
      expect(reads("/admin/shipments?page=1&pageSize=12")).toHaveLength(1);
      expect(screen.queryByRole("button", { name: "Atualizar envio" })).toBeNull();
      expect(mutations()).toEqual([]);
    },
  );

  it("aborta o detalhe inicial ao desmontar e descarta a resposta tardia antes de outro envio", async () => {
    const state = backend();
    const late = deferred<Detail>();
    state.detailWait = late.promise;
    const oldBusy = vi.fn();
    const original = mount({ initialShipmentId: shipmentId, onBusyChange: oldBusy });
    await waitFor(() => expect(reads(`/admin/shipments/${shipmentId}`)).toHaveLength(1));
    const oldSignal = reads(`/admin/shipments/${shipmentId}`)[0][1]?.signal;

    original.unmount();
    expect(oldSignal?.aborted).toBe(true);
    state.detailWait = null;
    mount({ initialShipmentId: secondId });
    await screen.findByText(/Outra pessoa demonstrativa/);
    await act(async () => late.resolve(detail()));

    expect(screen.getByText(/Outra pessoa demonstrativa/)).toBeTruthy();
    expect(screen.queryByText(/Destinatário demonstrativo/)).toBeNull();
    expect(reads("/admin/shipments?page=1&pageSize=12")).toHaveLength(0);
    expect(mutations()).toEqual([]);
    expect(oldBusy).not.toHaveBeenCalled();
  });

  it("carrega a fila paginada sem criar etiqueta nem enviar comandos ao provedor", async () => {
    backend();
    mount();
    await screen.findByRole("button", { name: `Gerenciar envio ${shipmentId}` });
    expect(vi.mocked(authorized).mock.calls[0][0]).toBe("/admin/shipments?page=1&pageSize=12");
    expect(mutations()).toEqual([]);
    expect(screen.queryByText("Destinatário demonstrativo")).toBeNull();
  });

  it("abre o detalhe por GET e exibe o endereço sem acionar operações automaticamente", async () => {
    backend();
    mount();
    await openDetail();
    await screen.findByText(/Destinatário demonstrativo/);
    expect(mutations()).toEqual([]);
    expect(reads(`/admin/shipments/${shipmentId}/label/print`)).toHaveLength(0);
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
  });

  it("atualiza a fila apenas por consulta e mantém ausência de operações automáticas", async () => {
    backend();
    mount();
    await screen.findByRole("button", { name: `Gerenciar envio ${shipmentId}` });
    fireEvent.click(screen.getByRole("button", { name: "Atualizar envios" }));
    await waitFor(() => expect(reads("/admin/shipments?page=1&pageSize=12")).toHaveLength(2));
    expect(mutations()).toEqual([]);
  });

  it("consulta a próxima página e remove as linhas da página anterior", async () => {
    const state = backend();
    state.total = 13;
    mount();
    await screen.findByRole("button", { name: `Gerenciar envio ${shipmentId}` });
    state.rows = [queueRow(state.other)];
    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    await screen.findByRole("button", { name: `Gerenciar envio ${secondId}` });
    expect(screen.queryByRole("button", { name: `Gerenciar envio ${shipmentId}` })).toBeNull();
    expect(reads("/admin/shipments?page=2&pageSize=12")).toHaveLength(1);
    expect(mutations()).toEqual([]);
  });

  it("retorna à última página existente quando um envio sai da fila", async () => {
    const state = backend();
    state.total = 13;
    mount();
    await screen.findByRole("button", { name: `Gerenciar envio ${shipmentId}` });
    state.rows = [queueRow(state.other)];
    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    await screen.findByRole("button", { name: `Gerenciar envio ${secondId}` });
    expect(screen.getByText("Página 2 de 2")).not.toBeNull();

    const remainingPage = deferred<AdminShipmentsPage>();
    vi.mocked(authorized)
      .mockResolvedValueOnce({ items: [], page: 2, pageSize: 12, total: 12 })
      .mockImplementationOnce(() => remainingPage.promise);
    fireEvent.click(screen.getByRole("button", { name: "Atualizar envios" }));
    await waitFor(() => expect(reads("/admin/shipments?page=1&pageSize=12")).toHaveLength(2));
    expect(screen.queryByText("Página 2 de 1")).toBeNull();
    expect(screen.queryByText(/Nenhum envio nesta página/)).toBeNull();
    await act(async () => remainingPage.resolve({
      items: [queueRow(state.current)], page: 1, pageSize: 12, total: 12,
    }));
    await screen.findByRole("button", { name: `Gerenciar envio ${shipmentId}` });
    expect(screen.getByText("Página 1 de 1")).not.toBeNull();
    expect(reads("/admin/shipments?page=2&pageSize=12")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: `Gerenciar envio ${secondId}` })).toBeNull();
    expect(mutations()).toEqual([]);
  });

  it("atualiza o detalhe por consulta explícita sem sincronizar ou pagar etiqueta", async () => {
    const state = backend();
    mount();
    await openDetail();
    state.current = detail({ trackingCode: "AA123456789BR", status: "SHIPPED", shippedAt: timestamp });
    fireEvent.click(screen.getByRole("button", { name: "Atualizar envio" }));
    await screen.findByText(/AA123456789BR/);
    expect(reads(`/admin/shipments/${shipmentId}`)).toHaveLength(2);
    expect(mutations()).toEqual([]);
  });

  it("oculta a fila quando a API nega acesso administrativo", async () => {
    const state = backend();
    state.listError = failure(403);
    mount();
    await screen.findByText(/Acesso restrito a administradores/);
    expect(screen.queryByRole("button", { name: `Gerenciar envio ${shipmentId}` })).toBeNull();
    expect(document.body.textContent).not.toContain("Falha interna confidencial");
    expect(mutations()).toEqual([]);
  });

  it("retira os dados do destinatário se a atualização recebe 403", async () => {
    const state = backend();
    mount();
    await openDetail();
    await screen.findByText(/Destinatário demonstrativo/);
    state.detailError = failure(403);
    fireEvent.click(screen.getByRole("button", { name: "Atualizar envio" }));
    await screen.findByText(/Acesso restrito a administradores/);
    expect(screen.queryByText(/Destinatário demonstrativo/)).toBeNull();
    expect(mutations()).toEqual([]);
  });

  it("não aplica detalhe que chega depois de desmontar a área", async () => {
    const state = backend();
    const pending = deferred<Detail>();
    state.detailWait = pending.promise;
    const view = mount();
    await openDetail();
    view.unmount();
    await act(async () => pending.resolve(detail()));
    expect(screen.queryByText(/Destinatário demonstrativo/)).toBeNull();
    expect(mutations()).toEqual([]);
  });

  it("descarta detalhe atrasado depois da troca de sessão", async () => {
    const state = backend();
    const pending = deferred<Detail>();
    state.detailWait = pending.promise;
    let current = true;
    mount({ isCurrentSession: () => current });
    await openDetail();
    current = false;
    await act(async () => pending.resolve(detail()));
    expect(screen.queryByText(/Destinatário demonstrativo/)).toBeNull();
    expect(mutations()).toEqual([]);
  });

  it("ignora resposta de um envio fechado quando outro envio já está aberto", async () => {
    const state = backend();
    state.rows = [queueRow(state.current), queueRow(state.other)];
    const pending = deferred<Detail>();
    state.detailWait = pending.promise;
    mount();
    await openDetail();
    fireEvent.click(screen.getByRole("button", { name: "Voltar aos envios" }));
    state.detailWait = null;
    await openDetail(secondId);
    await screen.findByText(/Outra pessoa demonstrativa/);
    await act(async () => pending.resolve(detail()));
    expect(screen.queryByText("Destinatário demonstrativo")).toBeNull();
    expect(screen.getByText(/Outra pessoa demonstrativa/)).not.toBeNull();
    expect(mutations()).toEqual([]);
  });

  it("permite criar etiqueta apenas depois de confirmar embalagem na API", async () => {
    const state = backend();
    mount();
    await openDetail();
    expect(screen.queryByRole("button", { name: "Enviar dados da etiqueta" })).toBeNull();
    await reviewPacking();
    expect(mutations()).toEqual([]);
    state.afterMutation = () => { state.current = detail({ packedAt: timestamp }); };
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar embalagem preparada" }));
    await screen.findByRole("button", { name: "Enviar dados da etiqueta" });
    expect(mutations()).toHaveLength(1);
    expect(mutations()[0][0]).toBe(`/admin/shipments/${shipmentId}/pack`);
    expect(reads(`/admin/shipments/${shipmentId}`)).toHaveLength(2);
  });

  it("não considera o POST de embalagem como prova do estado persistido", async () => {
    backend();
    mount();
    await openDetail();
    await reviewPacking();
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar embalagem preparada" }));
    await waitFor(() => expect(reads(`/admin/shipments/${shipmentId}`)).toHaveLength(2));
    expect(screen.queryByRole("button", { name: "Enviar dados da etiqueta" })).toBeNull();
    expect(mutations()).toHaveLength(1);
  });

  it("não cria etiqueta no simples carregamento de um envio já embalado", async () => {
    const state = backend();
    state.current = detail({ packedAt: timestamp });
    mount();
    await openDetail();
    await screen.findByRole("button", { name: "Enviar dados da etiqueta" });
    expect(mutations()).toEqual([]);
  });

  it("envia os dados do destinatário somente após ação explícita e depois consulta o detalhe", async () => {
    const state = backend();
    state.current = detail({ packedAt: timestamp });
    state.afterMutation = () => { state.current = detail({ packedAt: timestamp, label: label() }); };
    mount();
    await openDetail();
    fireEvent.click(await screen.findByRole("button", { name: "Enviar dados da etiqueta" }));
    await screen.findByRole("button", { name: "Confirmar compra revisada" });
    expect(mutations()).toHaveLength(1);
    const [path, request] = mutations()[0];
    expect(path).toBe(`/admin/shipments/${shipmentId}/label`);
    expect(JSON.parse(String(request?.body))).toEqual({ recipientDocument: "52998224725", recipientPhone: "11999999999" });
    expect(reads(`/admin/shipments/${shipmentId}`)).toHaveLength(2);
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
  });

  it("compra a etiqueta com custo exato revisado e não dispara geração automática", async () => {
    const state = backend();
    state.current = detail({ packedAt: timestamp, label: label() });
    state.afterMutation = () => { state.current = detail({ packedAt: timestamp, label: label({ status: "PURCHASED", checkoutStartedAt: timestamp }) }); };
    mount();
    await openDetail();
    expect(mutations()).toEqual([]);
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar compra revisada" }));
    await screen.findByRole("button", { name: "Gerar etiqueta" });
    expect(mutations()).toHaveLength(1);
    const [path, request] = mutations()[0];
    expect(path).toBe(`/admin/shipments/${shipmentId}/label/checkout`);
    expect(JSON.parse(String(request?.body))).toEqual({ expectedCost: "12.68" });
    expect(reads(`/admin/shipments/${shipmentId}`)).toHaveLength(2);
  });

  it("não permite comprar novamente quando o servidor já marcou início da compra", async () => {
    const state = backend();
    state.current = detail({ packedAt: timestamp, label: label({ checkoutStartedAt: timestamp }) });
    mount();
    await openDetail();
    await screen.findByRole("button", { name: "Sincronizar etiqueta" });
    expect(screen.queryByRole("button", { name: "Confirmar compra revisada" })).toBeNull();
    expect(mutations()).toEqual([]);
  });

  it("não oferece compra para um custo ausente ou inválido", async () => {
    const state = backend();
    state.current = detail({ packedAt: timestamp, label: label({ cost: null }) });
    mount();
    await openDetail();
    await screen.findByRole("button", { name: "Sincronizar etiqueta" });
    expect(screen.queryByRole("button", { name: "Confirmar compra revisada" })).toBeNull();
    expect(mutations()).toEqual([]);
  });

  it("gera somente após uma segunda confirmação e não obtém impressão automaticamente", async () => {
    const state = backend();
    state.current = detail({ packedAt: timestamp, label: label({ status: "PURCHASED", checkoutStartedAt: timestamp }) });
    state.afterMutation = () => { state.current = detail({ packedAt: timestamp, label: label({ status: "GENERATED", generatedAt: timestamp, checkoutStartedAt: timestamp, generateStartedAt: timestamp }) }); };
    mount();
    await openDetail();
    fireEvent.click(await screen.findByRole("button", { name: "Gerar etiqueta" }));
    expect(mutations()).toEqual([]);
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar geração" }));
    await screen.findByRole("button", { name: "Obter link de impressão" });
    expect(mutations()).toHaveLength(1);
    expect(mutations()[0][0]).toBe(`/admin/shipments/${shipmentId}/label/generate`);
    expect(reads(`/admin/shipments/${shipmentId}/label/print`)).toHaveLength(0);
  });

  it("não repete geração já iniciada mesmo que generatedAt ainda esteja vazio", async () => {
    const state = backend();
    state.current = detail({ packedAt: timestamp, label: label({ status: "PURCHASED", checkoutStartedAt: timestamp, generateStartedAt: timestamp }) });
    mount();
    await openDetail();
    await screen.findByRole("button", { name: "Sincronizar etiqueta" });
    expect(screen.queryByRole("button", { name: "Gerar etiqueta" })).toBeNull();
    expect(mutations()).toEqual([]);
  });

  it("sincroniza somente sob comando e não marca postagem ou entrega manualmente", async () => {
    const state = backend();
    state.current = detail({ packedAt: timestamp, label: label() });
    state.afterMutation = () => { state.current = detail({ status: "SHIPPED", packedAt: timestamp, shippedAt: timestamp, trackingCode: "AA123456789BR", label: label({ status: "POSTED" }) }); };
    mount();
    await openDetail();
    expect(mutations()).toEqual([]);
    fireEvent.click(await screen.findByRole("button", { name: "Sincronizar etiqueta" }));
    await screen.findByText(/AA123456789BR/);
    expect(mutations()).toHaveLength(1);
    expect(mutations()[0][0]).toBe(`/admin/shipments/${shipmentId}/label/sync`);
    expect(screen.queryByRole("button", { name: /Marcar (postagem|entrega)/i })).toBeNull();
  });

  it("recupera etiqueta ambígua usando o ID informado, sem repetir criação", async () => {
    const state = backend();
    state.current = detail({ packedAt: timestamp, label: label({ status: "CREATING", remoteId: null }) });
    state.afterMutation = () => { state.current = detail({ packedAt: timestamp, label: label() }); };
    mount();
    await openDetail();
    expect(screen.queryByRole("button", { name: "Enviar dados da etiqueta" })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar recuperação revisada" }));
    await screen.findByRole("button", { name: "Confirmar compra revisada" });
    expect(mutations()).toHaveLength(1);
    const [path, request] = mutations()[0];
    expect(path).toBe(`/admin/shipments/${shipmentId}/label/recover/${remoteId}`);
    expect(request?.body).toBeUndefined();
  });

  it("só apresenta link privado após ação explícita e confirmação atual do detalhe", async () => {
    const state = backend();
    state.current = detail({ packedAt: timestamp, label: label({ status: "GENERATED", generatedAt: timestamp }) });
    mount();
    await openDetail();
    await screen.findByRole("button", { name: "Obter link de impressão" });
    expect(document.querySelector('a[href*="melhorenvio.com.br"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Obter link de impressão" }));
    await waitFor(() => expect(document.querySelector('a[href="https://sandbox.melhorenvio.com.br/etiquetas/imprimir/teste"]')).not.toBeNull());
    expect(reads(`/admin/shipments/${shipmentId}/label/print`)).toHaveLength(1);
    expect(reads(`/admin/shipments/${shipmentId}`)).toHaveLength(2);
    const link = document.querySelector('a[href*="melhorenvio.com.br"]')!;
    expect(link.getAttribute("rel")).toContain("noreferrer");
    expect(mutations()).toEqual([]);
  });

  it.each([
    ["http://sandbox.melhorenvio.com.br/imprimir", "private"],
    ["https://melhorenvio.com.br/imprimir", "private"],
    ["https://sandbox.melhorenvio.com.br.exemplo.invalid/imprimir", "private"],
    ["https://usuario:senha@sandbox.melhorenvio.com.br/imprimir", "private"],
    ["https://sandbox.melhorenvio.com.br/imprimir", "public"],
  ])("recusa impressão com URL ou modo incompatível: %s / %s", async (url, mode) => {
    const state = backend();
    state.current = detail({ packedAt: timestamp, label: label({ status: "GENERATED", generatedAt: timestamp }) });
    state.printResult = { url, mode };
    mount();
    await openDetail();
    fireEvent.click(await screen.findByRole("button", { name: "Obter link de impressão" }));
    await screen.findByRole("alert");
    expect(document.querySelector('a[href*="melhorenvio.com.br"]')).toBeNull();
    expect(mutations()).toEqual([]);
  });

  it("descarta o link de impressão quando o detalhe atualizado perdeu a etiqueta gerada", async () => {
    const state = backend();
    state.current = detail({ packedAt: timestamp, label: label({ status: "GENERATED", generatedAt: timestamp }) });
    mount();
    await openDetail();
    await screen.findByRole("button", { name: "Obter link de impressão" });
    state.current = detail({ packedAt: timestamp, label: label({ status: "CANCELED", generatedAt: timestamp }) });
    fireEvent.click(screen.getByRole("button", { name: "Obter link de impressão" }));
    await waitFor(() => expect(reads(`/admin/shipments/${shipmentId}`)).toHaveLength(2));
    expect(document.querySelector('a[href*="melhorenvio.com.br"]')).toBeNull();
  });

  it("limpa um link já obtido assim que uma nova consulta do detalhe começa", async () => {
    const state = backend();
    state.current = detail({ packedAt: timestamp, label: label({ status: "GENERATED", generatedAt: timestamp }) });
    mount();
    await openDetail();
    fireEvent.click(await screen.findByRole("button", { name: "Obter link de impressão" }));
    await waitFor(() => expect(document.querySelector('a[href*="melhorenvio.com.br"]')).not.toBeNull());
    state.detailWait = new Promise(() => {});
    fireEvent.click(screen.getByRole("button", { name: "Atualizar envio" }));
    expect(document.querySelector('a[href*="melhorenvio.com.br"]')).toBeNull();
  });

  it("uma falha de criação bloqueia repetições até consulta explícita ao servidor", async () => {
    const state = backend();
    state.current = detail({ packedAt: timestamp });
    state.mutationError = failure(503);
    mount();
    await openDetail();
    fireEvent.click(await screen.findByRole("button", { name: "Enviar dados da etiqueta" }));
    await screen.findByRole("alert");
    expect(mutations()).toHaveLength(1);
    expect(reads(`/admin/shipments/${shipmentId}`)).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Enviar dados da etiqueta" })).toBeNull();
    expect(document.body.textContent).not.toContain("Falha interna confidencial");
    state.mutationError = null;
    state.current = detail({ packedAt: timestamp, label: label({ status: "CREATING", remoteId: null }) });
    fireEvent.click(screen.getByRole("button", { name: "Atualizar envio" }));
    await screen.findByRole("button", { name: "Confirmar recuperação revisada" });
    expect(mutations()).toHaveLength(1);
  });

  it("não libera a próxima etapa se a consulta após gravação falha", async () => {
    const state = backend();
    state.current = detail({ packedAt: timestamp });
    state.afterMutation = () => {
      state.current = detail({ packedAt: timestamp, label: label() });
      state.detailError = failure(503);
    };
    mount();
    await openDetail();
    fireEvent.click(await screen.findByRole("button", { name: "Enviar dados da etiqueta" }));
    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: "Confirmar compra revisada" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Enviar dados da etiqueta" })).toBeNull();
    expect(mutations()).toHaveLength(1);
    expect(reads(`/admin/shipments/${shipmentId}`)).toHaveLength(2);
  });

  it("invalida acesso ao receber 403 durante uma operação", async () => {
    const state = backend();
    state.current = detail({ packedAt: timestamp });
    state.mutationError = failure(403);
    mount();
    await openDetail();
    fireEvent.click(await screen.findByRole("button", { name: "Enviar dados da etiqueta" }));
    await screen.findByText(/Acesso restrito a administradores/);
    expect(screen.queryByText(/Destinatário demonstrativo/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Enviar dados da etiqueta" })).toBeNull();
  });

  it("não envia operação quando a sessão do formulário deixou de ser atual", async () => {
    const state = backend();
    state.current = detail({ packedAt: timestamp });
    let current = true;
    mount({ isCurrentSession: () => current });
    await openDetail();
    await screen.findByRole("button", { name: "Enviar dados da etiqueta" });
    current = false;
    fireEvent.click(screen.getByRole("button", { name: "Enviar dados da etiqueta" }));
    expect(mutations()).toEqual([]);
  });

  it("bloqueia cliques repetidos durante uma compra pendente", async () => {
    const state = backend();
    state.current = detail({ packedAt: timestamp, label: label() });
    state.mutationWait = new Promise(() => {});
    const onBusyChange = vi.fn();
    mount({ onBusyChange });
    await openDetail();
    const confirm = await screen.findByRole("button", { name: "Confirmar compra revisada" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(onBusyChange).toHaveBeenLastCalledWith(true);
  });

  it("aborta operação após 15 segundos, ignora resposta tardia e não repete o POST", async () => {
    const state = backend();
    state.current = detail({ packedAt: timestamp, label: label() });
    const pending = deferred<ShippingLabelDto>();
    state.mutationWait = pending.promise;
    const onBusyChange = vi.fn();
    mount({ onBusyChange });
    await openDetail();
    const confirm = await screen.findByRole("button", { name: "Confirmar compra revisada" });
    vi.useFakeTimers();
    try {
      fireEvent.click(confirm);
      expect(mutations()).toHaveLength(1);
      const signal = mutations()[0][1]?.signal;
      expect(signal?.aborted).toBe(false);
      await act(async () => vi.advanceTimersByTimeAsync(15_000));
      expect(signal?.aborted).toBe(true);
      expect(onBusyChange).toHaveBeenLastCalledWith(false);
      expect(screen.getByRole("alert").textContent).not.toBe("");
      await act(async () => pending.resolve(label({ status: "PURCHASED" })));
      await act(async () => vi.advanceTimersByTimeAsync(30_000));
      expect(mutations()).toHaveLength(1);
      expect(reads(`/admin/shipments/${shipmentId}`)).toHaveLength(1);
      expect(screen.queryByRole("button", { name: "Gerar etiqueta" })).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it("libera a interface quando a consulta de confirmação após POST não responde", async () => {
    const state = backend();
    state.current = detail({ packedAt: timestamp });
    state.afterMutation = () => {
      state.current = detail({ packedAt: timestamp, label: label() });
      state.detailWait = new Promise(() => {});
    };
    const onBusyChange = vi.fn();
    mount({ onBusyChange });
    await openDetail();
    const submit = await screen.findByRole("button", { name: "Enviar dados da etiqueta" });
    vi.useFakeTimers();
    try {
      fireEvent.click(submit);
      await act(async () => {});
      expect(mutations()).toHaveLength(1);
      expect(reads(`/admin/shipments/${shipmentId}`)).toHaveLength(2);
      expect(onBusyChange).toHaveBeenLastCalledWith(true);
      await act(async () => vi.advanceTimersByTimeAsync(15_000));
      expect(reads(`/admin/shipments/${shipmentId}`)[1][1]?.signal?.aborted).toBe(true);
      expect(onBusyChange).toHaveBeenLastCalledWith(false);
      expect(screen.getByRole("alert").textContent).not.toBe("");
      expect(screen.queryByRole("button", { name: "Confirmar compra revisada" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Enviar dados da etiqueta" })).toBeNull();
      await act(async () => vi.advanceTimersByTimeAsync(30_000));
      expect(mutations()).toHaveLength(1);
      expect(reads(`/admin/shipments/${shipmentId}`)).toHaveLength(2);
    } finally { vi.useRealTimers(); }
  });
});
