// Utilitários de exportação e importação de dados da casa (JSON/CSV).

export type HouseExportData = {
  version: "1.0";
  exportedAt: string;
  houseName?: string;
  products: Array<{
    name: string;
    category?: string;
    unit?: string;
    inventoryQuantity?: string;
    inventoryStatus?: "in_stock" | "missing";
    alertThreshold?: string | null;
    occasional?: boolean;
    barcode?: string | null;
  }>;
  shoppingListItems?: Array<{
    productName: string;
    quantity?: string;
    checked?: boolean;
  }>;
};

export function exportToJSON(data: HouseExportData): string {
  return JSON.stringify(data, null, 2);
}

function escapeCSV(val: string | number | boolean | null | undefined): string {
  if (val === null || val === undefined) return '""';
  const str = String(val);
  if (str.includes('"') || str.includes(",") || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return `"${str}"`;
}

export function exportToCSV(data: HouseExportData): string {
  const headers = [
    "Nome",
    "Categoria",
    "Unidade",
    "Estoque",
    "Status Estoque",
    "Limiar Alerta",
    "Eventual",
    "Código de Barras",
    "Na Lista",
  ];
  const rows: string[] = [headers.map(escapeCSV).join(",")];

  const listedMap = new Map<string, { quantity?: string; checked?: boolean }>();
  if (data.shoppingListItems) {
    for (const item of data.shoppingListItems) {
      listedMap.set(item.productName.toLowerCase(), item);
    }
  }

  for (const p of data.products) {
    const listed = listedMap.get(p.name.toLowerCase());
    rows.push(
      [
        p.name,
        p.category ?? "",
        p.unit ?? "un",
        p.inventoryQuantity ?? "0",
        p.inventoryStatus ?? "in_stock",
        p.alertThreshold ?? "",
        p.occasional ? "Sim" : "Não",
        p.barcode ?? "",
        listed ? (listed.checked ? "Comprado" : "Sim") : "Não",
      ]
        .map(escapeCSV)
        .join(",")
    );
  }

  return rows.join("\n");
}

export function validateHouseImport(
  rawContent: string
): { ok: true; data: HouseExportData } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(rawContent);
    if (!parsed || typeof parsed !== "object") {
      return { ok: false, error: "O conteúdo informado não é um objeto JSON válido." };
    }

    if (!Array.isArray(parsed.products)) {
      return { ok: false, error: "O arquivo de backup deve conter uma lista de 'products'." };
    }

    const validProducts: HouseExportData["products"] = [];
    for (const p of parsed.products) {
      if (!p || typeof p !== "object" || typeof p.name !== "string" || !p.name.trim()) {
        continue;
      }
      validProducts.push({
        name: p.name.trim(),
        category: typeof p.category === "string" ? p.category : undefined,
        unit: typeof p.unit === "string" ? p.unit : undefined,
        inventoryQuantity: typeof p.inventoryQuantity === "string" ? p.inventoryQuantity : undefined,
        inventoryStatus: p.inventoryStatus === "missing" ? "missing" : "in_stock",
        alertThreshold: typeof p.alertThreshold === "string" ? p.alertThreshold : null,
        occasional: Boolean(p.occasional),
        barcode: typeof p.barcode === "string" ? p.barcode : null,
      });
    }

    if (validProducts.length === 0) {
      return { ok: false, error: "Nenhum produto válido foi encontrado no arquivo de backup." };
    }

    return {
      ok: true,
      data: {
        version: "1.0",
        exportedAt: typeof parsed.exportedAt === "string" ? parsed.exportedAt : new Date().toISOString(),
        houseName: typeof parsed.houseName === "string" ? parsed.houseName : undefined,
        products: validProducts,
        shoppingListItems: Array.isArray(parsed.shoppingListItems) ? parsed.shoppingListItems : [],
      },
    };
  } catch {
    return { ok: false, error: "Falha ao analisar o JSON de backup." };
  }
}
