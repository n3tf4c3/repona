// Consulta o Open Food Facts pelo código de barras para pré-preencher o
// cadastro de produto. É "best effort": o app é offline-first, então qualquer
// falha (sem internet, timeout, código desconhecido) devolve null e o cadastro
// segue manual, como sempre foi.
export type DadosOFF = {
  nome: string;
  marca: string | null;
  quantidade: string | null;
  imagemUrl: string | null;
};

// Só os campos usados: corta o payload, que no endpoint cheio passa de 100 KB.
const FIELDS = 'product_name,product_name_pt,brands,quantity,image_front_url';

export async function buscarProdutoPorCodigo(codigo: string): Promise<DadosOFF | null> {
  const code = codigo.trim();
  // OFF indexa EAN/UPC (8 a 14 dígitos); outros formatos nem valem a chamada.
  if (!/^\d{8,14}$/.test(code)) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${FIELDS}`,
      { signal: controller.signal },
    );
    clearTimeout(timer);
    if (!response.ok) return null;

    const data = await response.json();
    if (data.status !== 1 || !data.product) return null;

    const nome = String(data.product.product_name_pt || data.product.product_name || '').trim();
    if (!nome) return null;

    return {
      nome,
      marca: String(data.product.brands ?? '').split(',')[0]?.trim() || null,
      quantidade: String(data.product.quantity ?? '').trim() || null,
      imagemUrl: data.product.image_front_url || null,
    };
  } catch {
    return null;
  }
}
