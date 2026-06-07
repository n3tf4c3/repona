// Contrato de sincronização por casa (backup na nuvem). O mobile envia o seu
// snapshot e recebe de volta o snapshot mesclado da casa. A chave de merge é o
// NOME do produto (case-insensitive), porque web e mobile têm espaços de ID
// independentes. Histórico e consumo são append-only com dedupe — nada é
// apagado de nenhum lado.

import type { ProductStatus, InventoryStatus } from "./contracts";

export type SyncProduct = {
  name: string;
  category: string;
  barcode: string | null;
  photoUri: string | null;
  purchaseCount: number;
  status: ProductStatus;
  alertThreshold: string | null;
  inventoryQuantity: string;
  inventoryStatus: InventoryStatus;
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

// Chave de dedupe de um evento (compra/consumo): produto + instante + quantidade.
export function eventKey(productName: string, isoDate: string, quantity: string): string {
  return `${productNameKey(productName)}|${isoDate}|${quantity.trim()}`;
}
