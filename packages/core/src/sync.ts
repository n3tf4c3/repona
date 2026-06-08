// Contrato de sincronização por casa (backup na nuvem). O mobile envia o seu
// snapshot e recebe de volta o snapshot mesclado da casa. A chave de merge é o
// NOME do produto (case-insensitive), porque web e mobile têm espaços de ID
// independentes. Histórico e consumo são append-only com dedupe — nada é
// apagado de nenhum lado.

import type { ProductStatus, InventoryStatus } from "./contracts";

export type SyncProduct = {
  // Identidade estável compartilhada (UUID); nome é só atributo. Opcional para
  // tolerar clientes antigos na transição — nesse caso o merge casa por nome.
  syncId?: string;
  name: string;
  category: string;
  barcode: string | null;
  photoUri: string | null;
  purchaseCount: number;
  status: ProductStatus;
  alertThreshold: string | null;
  inventoryQuantity: string;
  inventoryStatus: InventoryStatus;
  archived: boolean;
  occasional: boolean;
};

export type SyncPurchase = {
  productName: string;
  quantity: string;
  purchasedAt: string; // ISO
};

export type SyncConsumption = {
  productName: string;
  quantity: string;
  occurredAt: string; // ISO
};

export type SyncPrice = {
  productName: string;
  priceCents: number;
  recordedAt: string; // ISO
};

export type SyncSnapshot = {
  products: SyncProduct[];
  purchases: SyncPurchase[];
  consumptions: SyncConsumption[];
  prices: SyncPrice[];
};

export function productNameKey(name: string): string {
  return name.trim().toLocaleLowerCase("pt-BR");
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

// Reconciliação de identidade do produto no merge: casa por syncId primeiro e
// cai para o nome (legado/transição). Quem chama decide o que fazer com cada
// caso — no servidor o syncId local vence; no mobile o id do servidor é adotado.
export type ProductMatchMaps = {
  idBySyncId: Map<string, number>;
  idByName: Map<string, number>;
};

export type ProductMatch =
  | { id: number; matchedBy: "syncId" | "name" }
  | { id: null; matchedBy: "none" };

export function matchProduct(
  input: { syncId?: string | null; name: string },
  maps: ProductMatchMaps
): ProductMatch {
  if (input.syncId) {
    const porSync = maps.idBySyncId.get(input.syncId);
    if (porSync !== undefined) return { id: porSync, matchedBy: "syncId" };
  }
  const porNome = maps.idByName.get(productNameKey(input.name));
  if (porNome !== undefined) return { id: porNome, matchedBy: "name" };
  return { id: null, matchedBy: "none" };
}

// Chave de dedupe de um evento (compra/consumo): produto + instante + quantidade.
// O instante é normalizado para segundos de epoch para tolerar diferenças de
// formato/precisão de fração de segundo introduzidas no ida-e-volta pela nuvem
// (ex.: o mesmo instante salvo local e relido do Postgres não bate byte a byte).
export function eventKey(productName: string, isoDate: string, quantity: string): string {
  return `${productNameKey(productName)}|${instantKey(isoDate)}|${quantity.trim()}`;
}

function instantKey(isoDate: string): string {
  const ms = new Date(isoDate).getTime();
  return Number.isNaN(ms) ? isoDate : String(Math.floor(ms / 1000));
}
