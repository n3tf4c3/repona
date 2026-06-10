// Tela de estoque: só as quantidades da casa — ajustar, marcar em falta,
// registrar consumo e mandar pra lista. O catálogo (cadastro/edição) vive na
// tela Produtos. Finalizar uma compra alimenta estas quantidades.
import { useMemo, useState } from 'react';
import { Text } from 'react-native';

import { buildInventoryAlerts, CATEGORIAS } from '@repona/core';

import { EstoqueRow, filterProducts } from '../components/products';
import { ChipRow, EmptyState, Header, IconButton, ScreenScroll, SearchBox } from '../components/ui';
import { styles } from '../styles';
import type { Product } from '../types';

export function EstoqueScreen({
  products,
  isReady,
  errorMessage,
  onAddProductToList,
  onChangeInventory,
  onMarkInventoryMissing,
  onConsumeProduct,
}: {
  products: Product[];
  isReady: boolean;
  errorMessage: string | null;
  onAddProductToList: (product: Product) => void;
  onChangeInventory: (product: Product, direction: 1 | -1) => void;
  onMarkInventoryMissing: (product: Product) => void;
  onConsumeProduct: (product: Product) => void;
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Todos');
  const [onlyNeedsRestock, setOnlyNeedsRestock] = useState(false);
  const restockIds = useMemo(
    () => new Set(buildInventoryAlerts(products).map((alert) => alert.product.id)),
    [products],
  );
  const filteredProducts = useMemo(() => {
    const base = filterProducts(products, searchTerm, selectedCategory);
    return onlyNeedsRestock ? base.filter((product) => restockIds.has(product.id)) : base;
  }, [products, searchTerm, selectedCategory, onlyNeedsRestock, restockIds]);
  const hasFilters = searchTerm.trim().length > 0 || selectedCategory !== 'Todos' || onlyNeedsRestock;

  return (
    <ScreenScroll>
      <Header
        eyebrow="O que tem em casa"
        title="Estoque"
        actions={
          <IconButton
            icon="tune-variant"
            badge={onlyNeedsRestock}
            onPress={() => setOnlyNeedsRestock((value) => !value)}
          />
        }
      />
      <SearchBox placeholder="Buscar item..." value={searchTerm} onChangeText={setSearchTerm} />
      {errorMessage ? <Text style={styles.productError}>{errorMessage}</Text> : null}
      {onlyNeedsRestock ? <Text style={styles.subtleText}>Mostrando só itens em falta ou com estoque baixo.</Text> : null}
      <ChipRow chips={['Todos', ...CATEGORIAS]} selected={selectedCategory} onSelect={setSelectedCategory} />
      {!isReady ? (
        <EmptyState title="Carregando estoque" description="Buscando os itens salvos localmente." />
      ) : filteredProducts.length === 0 ? (
        hasFilters ? (
          <EmptyState title="Nenhum resultado" description="Tente outro nome ou categoria." />
        ) : (
          <EmptyState title="Estoque vazio" description="Finalize uma compra para alimentar o estoque automaticamente." />
        )
      ) : (
        filteredProducts.map((product) => (
          <EstoqueRow
            key={product.id ?? product.name}
            product={product}
            onAdd={onAddProductToList}
            onChangeInventory={onChangeInventory}
            onMarkInventoryMissing={onMarkInventoryMissing}
            onConsume={onConsumeProduct}
          />
        ))
      )}
    </ScreenScroll>
  );
}
