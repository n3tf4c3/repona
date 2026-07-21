// Contrato de sincronização por casa (backup na nuvem). O mobile envia o seu
// snapshot e recebe de volta o snapshot mesclado da casa. A chave de merge é o
// NOME do produto (case-insensitive), porque web e mobile têm espaços de ID
// independentes. Histórico e consumo são append-only com dedupe — nada é
// apagado de nenhum lado.

import type { ProductStatus, InventoryStatus } from "./contracts";
import { normalizeQuantity } from "./inventory-quantity";

export type SyncProduct = {
  // Identidade estável compartilhada (UUID); nome é só atributo. Opcional para
  // tolerar clientes antigos na transição — nesse caso o merge casa por nome.
  syncId?: string;
  // Instante da última modificação do produto (atributos ou estoque), ISO. Base
  // do LWW: só sobrescreve quando o recebido é mais novo. Opcional p/ cliente
  // legado (sem ele, aplica como antes). (auditoria #2)
  updatedAt?: string;
  // Protocolo v2 separa o relógio dos metadados do relógio do estoque. O campo
  // updatedAt acima permanece só para clientes v1 durante a transição. (#2)
  metadataUpdatedAt?: string;
  inventoryUpdatedAt?: string;
  name: string;
  category: string;
  // Marca do produto. Opcional para tolerar clientes/servidores antigos.
  brand?: string | null;
  barcode: string | null;
  // Foto NÃO entra no sync: é uma URI local do dispositivo, sem valor em outro
  // aparelho/nuvem. Fica estritamente local no mobile. (auditoria #6)
  purchaseCount: number;
  status: ProductStatus;
  alertThreshold: string | null;
  inventoryQuantity: string;
  inventoryStatus: InventoryStatus;
  archived: boolean;
  occasional: boolean;
};

export type SyncPurchase = {
  // Identidade do evento. Opcional apenas para eventos criados por clientes v1;
  // eventos novos sempre carregam UUID e nunca são colapsados por timestamp. (#73)
  syncId?: string;
  productName: string;
  quantity: string;
  purchasedAt: string; // ISO
  // Nome da lista de origem, denormalizado no momento da compra (auditoria #17).
  // O id da lista é local a cada device, então viaja o nome; compras
  // sincronizadas preservam a origem em vez de cair em "Compra finalizada".
  // Opcional/nulo para compras sem lista e clientes antigos.
  sourceListName?: string | null;
  // Tombstone: a edição do histórico marca deleted em vez de apagar, para a
  // exclusão propagar sem ressuscitar (mesmo racional do SyncListItem).
  // Opcional para tolerar clientes/servidores antigos.
  deleted?: boolean;
  // Carimbo da última EDIÇÃO do tombstone (excluir/re-incluir), base do LWW de
  // shouldApplyIncomingDeleted. Nulo = nunca editado (compra normal de
  // finalização) ou cliente antigo — nesse caso vale a regra conservadora:
  // deleted vence, un-delete não aplica. (auditoria #65)
  updatedAt?: string | null;
};

export type SyncConsumption = {
  syncId?: string;
  // `consumed` (ou ausente em clientes v1) é delta; `set` redefine a base
  // absoluta. O saldo é derivado do último set + deltas posteriores. (#72)
  eventType?: "consumed" | "set";
  productName: string;
  quantity: string;
  occurredAt: string; // ISO
};

export type SyncPrice = {
  syncId?: string;
  productName: string;
  priceCents: number;
  recordedAt: string; // ISO
};

// Item da lista de compras ativa da casa (auditoria #9). A lista ativa é tratada
// como um conjunto por casa, com identidade pelo produto. A deleção é um
// tombstone (`deleted`) em vez de remoção física, para que finalizar/remover não
// seja "ressuscitado" por um device que ainda tinha o item. Merge por `updatedAt`
// (LWW), igual aos produtos.
export type SyncListItem = {
  productName: string;
  quantity: string;
  checked: boolean;
  deleted: boolean;
  updatedAt: string; // ISO
};

export type SyncSnapshot = {
  products: SyncProduct[];
  purchases: SyncPurchase[];
  consumptions: SyncConsumption[];
  prices: SyncPrice[];
  // Opcional para tolerar clientes antigos que não enviam a lista. (auditoria #9)
  listItems?: SyncListItem[];
};

// Chave de identidade por nome usada no merge (matchProduct) e no dedupe de
// eventos (eventKey), nos DOIS lados do sync. Normaliza Unicode em NFC antes de
// baixar caixa, para que formas canonicamente equivalentes de um acento
// (precomposto vs combinante) — visualmente idênticas mas com bytes diferentes —
// colapsem na mesma chave e não virem produtos/eventos distintos. Usa NFC (não
// NFKC) de propósito: só unifica equivalentes canônicos, sem arriscar juntar
// nomes que o usuário vê como diferentes. (auditoria #76)
export function productNameKey(name: string): string {
  return name.normalize("NFC").trim().toLocaleLowerCase("pt-BR");
}

// UUID v4 baseado em Math.random. Suficiente para um id de sync doméstico —
// colisão é astronomicamente improvável e o id não tem valor de segurança.
export function uuidv4(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Reconciliação de identidade do produto no merge: casa por syncId, depois pelo
// código de barras, e cai para o nome (legado/transição). Quem chama decide o
// que fazer com cada caso — no servidor o syncId local vence; no mobile o id do
// servidor é adotado. idByBarcode é opcional e só contém códigos não-nulos:
// produtos sem barcode (ex.: hortifrúti) nunca casam por essa via.
export type ProductMatchMaps = {
  idBySyncId: Map<string, number>;
  idByName: Map<string, number>;
  idByBarcode?: Map<string, number>;
};

export type ProductMatch =
  | { id: number; matchedBy: "syncId" | "barcode" | "name" }
  | { id: null; matchedBy: "none" };

export function matchProduct(
  input: { syncId?: string | null; name: string; barcode?: string | null },
  maps: ProductMatchMaps
): ProductMatch {
  if (input.syncId) {
    const porSync = maps.idBySyncId.get(input.syncId);
    if (porSync !== undefined) return { id: porSync, matchedBy: "syncId" };
  }
  // Só casa por barcode quando ambos os lados têm código não-vazio: NULL nunca
  // casa com NULL, então itens sem código seguem pelo nome como antes.
  const barcode = input.barcode?.trim();
  if (barcode && maps.idByBarcode) {
    const porBarcode = maps.idByBarcode.get(barcode);
    if (porBarcode !== undefined) return { id: porBarcode, matchedBy: "barcode" };
  }
  const porNome = maps.idByName.get(productNameKey(input.name));
  if (porNome !== undefined) return { id: porNome, matchedBy: "name" };
  return { id: null, matchedBy: "none" };
}

// LWW: decide se o registro recebido deve sobrescrever o local. Sem updatedAt
// no recebido (cliente legado) aplica como antes; datas inválidas também
// aplicam, para não travar o merge. Empate não sobrescreve (idempotente).
export function shouldApplyIncoming(
  incomingUpdatedAt: string | undefined | null,
  storedUpdatedAt: string,
  nowMs: number = Date.now()
): boolean {
  if (!incomingUpdatedAt) return true;
  const recebido = new Date(incomingUpdatedAt).getTime();
  const atual = new Date(storedUpdatedAt).getTime();
  if (Number.isNaN(recebido) || Number.isNaN(atual)) return true;
  // Um relógio de device muito no futuro não pode "ganhar para sempre" e
  // bloquear edições legítimas dos demais aparelhos. Cinco minutos acomodam
  // drift normal; acima disso o carimbo é rejeitado. (#2)
  if (recebido > nowMs + MAX_CLOCK_SKEW_MS) return false;
  return recebido > atual;
}

export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

// LWW do tombstone de compra (auditoria #65): decide se o estado deleted
// recebido substitui o local. Difere de shouldApplyIncoming num ponto crucial:
// SEM carimbo no recebido, só a exclusão aplica — uma compra viva re-enviada
// por cliente antigo nunca ressuscita um tombstone. Com carimbo dos dois lados,
// o mais novo vence (empate não aplica, idempotente); o lado carimbado vence o
// não-carimbado, para a re-inclusão feita na edição do histórico (que carimba)
// sobreviver ao tombstone antigo. Usada pelo merge do servidor e pelo
// applySnapshot do mobile — manter uma única implementação.
export function shouldApplyIncomingDeleted(
  incoming: { deleted: boolean; updatedAt?: string | null },
  existing: { deleted: boolean; updatedAt?: string | null }
): boolean {
  if (incoming.deleted === existing.deleted) return false;
  const recebido = incoming.updatedAt ? new Date(incoming.updatedAt).getTime() : NaN;
  // Recebido sem carimbo (ou inválido): regra conservadora — deleted vence.
  if (Number.isNaN(recebido)) return incoming.deleted;
  const atual = existing.updatedAt ? new Date(existing.updatedAt).getTime() : NaN;
  if (Number.isNaN(atual)) return true;
  return recebido > atual;
}

// Chave de dedupe de um evento (compra/consumo): produto + instante + quantidade.
// O instante é normalizado para segundos de epoch para tolerar diferenças de
// formato/precisão de fração de segundo introduzidas no ida-e-volta pela nuvem
// (ex.: o mesmo instante salvo local e relido do Postgres não bate byte a byte).
export function eventKey(productName: string, isoDate: string, quantity: string): string {
  return `${productNameKey(productName)}|${instantKey(isoDate)}|${normalizeQuantity(quantity)}`;
}

// Regra de transição do evento v2: dois UUIDs presentes só representam o mesmo
// evento quando são iguais. A chave antiga por conteúdo entra apenas se ao menos
// um lado ainda não possui UUID; assim eventos legítimos iguais no mesmo segundo
// sobrevivem, sem duplicar o legado durante a migração nullable. (#73)
export function sameSyncEvent(
  incoming: { syncId?: string | null; legacyKey: string },
  stored: { syncId?: string | null; legacyKey: string }
): boolean {
  if (incoming.syncId && stored.syncId) return incoming.syncId === stored.syncId;
  return incoming.legacyKey === stored.legacyKey;
}

function instantKey(isoDate: string): string {
  const ms = new Date(isoDate).getTime();
  return Number.isNaN(ms) ? isoDate : String(Math.floor(ms / 1000));
}
