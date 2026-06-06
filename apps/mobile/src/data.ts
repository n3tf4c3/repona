import { colors } from './theme';
import { IconName, Product, ShoppingItem } from './types';

export const frequentProducts: Product[] = [
  product('Leite integral', 'Laticínios · toda semana', 'bottle-tonic-outline', colors.amberSoft, colors.amber),
  product('Maçã Fuji', 'Hortifrúti · toda semana', 'food-apple-outline', colors.primarySoft, colors.primaryStrong),
];

export const catalogProducts: Product[] = [
  product('Leite integral', 'Laticínios · 12 compras', 'bottle-tonic-outline', colors.amberSoft, colors.amber),
  product('Maçã Fuji', 'Hortifrúti · 9 compras', 'food-apple-outline', colors.primarySoft, colors.primaryStrong),
  product('Café torrado', 'Bebidas · em falta', 'coffee-outline', colors.coralSoft, colors.coral),
  product('Ovos brancos', 'Hortifrúti · 11 compras', 'egg-outline', colors.indigoSoft, colors.indigo),
  product('Cenoura', 'Hortifrúti · 6 compras', 'carrot', colors.primarySoft, colors.primaryStrong),
  product('Biscoito', 'Mercearia · 5 compras', 'cookie-outline', colors.amberSoft, colors.amber),
];

export const initialShoppingItems: ShoppingItem[] = [
  item(1, 'Hortifrúti', colors.primary, 'Maçã Fuji', 'R$ 8,90 / kg', '1 kg', true),
  item(2, 'Hortifrúti', colors.primary, 'Cenoura', 'R$ 4,50 / kg', '500 g', false),
  item(3, 'Hortifrúti', colors.primary, 'Banana prata', 'R$ 5,20 / kg', '1 kg', false),
  item(4, 'Laticínios & Bebidas', colors.amber, 'Leite integral', 'R$ 5,49 · 2 un', '2 un', true),
  item(5, 'Laticínios & Bebidas', colors.amber, 'Café torrado', '', '1 un', false, true),
  item(6, 'Laticínios & Bebidas', colors.amber, 'Suco de laranja', 'R$ 7,90 · 1 un', '1 un', false),
];

export const historyGroups = [
  {
    title: 'Esta semana',
    items: [
      {
        title: 'Compra da Semana',
        total: 'R$ 231,40',
        date: 'Sáb, 29 mai',
        count: '14 itens',
        thumbs: [
          thumb('bottle-tonic-outline', colors.amberSoft, colors.amber),
          thumb('food-apple-outline', colors.primarySoft, colors.primaryStrong),
          thumb('egg-outline', colors.indigoSoft, colors.indigo),
        ],
        more: '+11',
      },
    ],
  },
  {
    title: 'Maio',
    items: [
      {
        title: 'Reposição rápida',
        total: 'R$ 86,10',
        date: 'Qua, 21 mai',
        count: '5 itens',
        thumbs: [
          thumb('coffee-outline', colors.coralSoft, colors.coral),
          thumb('carrot', colors.primarySoft, colors.primaryStrong),
        ],
        more: '+3',
      },
      {
        title: 'Compra do mês',
        total: 'R$ 412,75',
        date: 'Sáb, 3 mai',
        count: '26 itens',
        thumbs: [],
        more: null,
      },
    ],
  },
];

export const futureFeatures = [
  feature('Scanner de código', 'Aponte a câmera e adicione produtos pelo código de barras.', 'barcode-scan'),
  feature('Cadastro por foto', 'Tire uma foto do produto e complete o cadastro em menos passos.', 'camera-outline'),
  feature('Estoque doméstico', 'Saiba o que tem em casa, o que está acabando e o que precisa repor.', 'home-variant-outline'),
  feature('Compartilhamento familiar', 'Toda a família na mesma lista, atualizada em tempo real.', 'account-group-outline'),
  feature('Sugestões inteligentes', 'Recompras previstas a partir dos hábitos de consumo.', 'brain'),
  feature('Ciclo de vida do item', 'Planejado, comprado, consumido e em falta em um único fluxo.', 'refresh'),
];

function product(name: string, meta: string, icon: IconName, background: string, tint: string): Product {
  return { name, meta, icon, background, tint };
}

function item(
  id: number,
  category: string,
  categoryColor: string,
  name: string,
  meta: string,
  quantity: string,
  checked: boolean,
  missing = false,
): ShoppingItem {
  return { id, category, categoryColor, name, meta, quantity, checked, missing };
}

function thumb(icon: IconName, background: string, tint: string) {
  return { icon, background, tint };
}

function feature(title: string, description: string, icon: IconName) {
  return { title, description, icon };
}
