// Tela do catálogo de produtos, com busca, filtros e arquivados (extraída de
// App.tsx, auditoria 2026-06-09 #12.1).
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Pressable, Text } from 'react-native';

import { buildInventoryAlerts, CATEGORIAS, type PriceSummary } from '@repona/core';

import { ArchivedProductRow, ProductList } from '../components/products';
import { ChipRow, EmptyState, Header, IconButton, ScreenScroll, SearchBox } from '../components/ui';
import { styles } from '../styles';
import { colors } from '../theme';
import type { Product } from '../types';

export function ProductsScreen({
  products,
  archivedProducts,
  isProductsReady,
  errorMessage,
  priceSummaries,
  onAddProductToList,
  onEditProduct,
  onRemoveProduct,
  onChangeInventory,
  onMarkInventoryMissing,
  onConsumeProduct,
  onRegisterPrice,
  onUnarchiveProduct,
}: {
  products: Product[];
  archivedProducts: Product[];
  isProductsReady: boolean;
  errorMessage: string | null;
  priceSummaries: Map<number, PriceSummary>;
  onAddProductToList: (product: Product) => void;
  onEditProduct: (product: Product) => void;
  onRemoveProduct: (product: Product) => void;
  onChangeInventory: (product: Product, direction: 1 | -1) => void;
  onMarkInventoryMissing: (product: Product) => void;
  onConsumeProduct: (product: Product) => void;
  onRegisterPrice: (product: Product) => void;
  onUnarchiveProduct: (product: Product) => void;
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Todos');
  const [onlyNeedsRestock, setOnlyNeedsRestock] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const restockIds = useMemo(
    () => new Set(buildInventoryAlerts(products).map((alert) => alert.product.id)),
    [products],
  );
  const filteredProducts = useMemo(() => {
    const base = filterProducts(products, searchTerm, selectedCategory);
    return onlyNeedsRestock ? base.filter((product) => restockIds.has(product.id)) : base;
  }, [products, searchTerm, selectedCategory, onlyNeedsRestock, restockIds]);
  const filteredArchived = useMemo(
    () => filterProducts(archivedProducts, searchTerm, selectedCategory),
    [archivedProducts, searchTerm, selectedCategory],
  );

  return (
    <ScreenScroll>
      <Header
        eyebrow="Catálogo da casa"
        title="Produtos"
        actions={
          <IconButton
            icon="tune-variant"
            badge={onlyNeedsRestock}
            onPress={() => setOnlyNeedsRestock((value) => !value)}
          />
        }
      />
      <SearchBox placeholder="Buscar produto..." value={searchTerm} onChangeText={setSearchTerm} />
      {errorMessage ? <Text style={styles.productError}>{errorMessage}</Text> : null}
      {onlyNeedsRestock ? <Text style={styles.subtleText}>Mostrando só itens em falta ou com estoque baixo.</Text> : null}
      <ChipRow chips={['Todos', ...CATEGORIAS]} selected={selectedCategory} onSelect={setSelectedCategory} />
      {archivedProducts.length > 0 ? (
        <Pressable
          style={[styles.archivedToggle, showArchived ? styles.archivedToggleActive : null]}
          onPress={() => setShowArchived((value) => !value)}
        >
          <MaterialCommunityIcons name="archive-outline" size={15} color={showArchived ? colors.surface : colors.ink2} />
          <Text style={[styles.archivedToggleText, showArchived ? styles.archivedToggleTextActive : null]}>
            {showArchived ? 'Mostrando arquivados' : `Mostrar arquivados (${archivedProducts.length})`}
          </Text>
        </Pressable>
      ) : null}
      {showArchived ? (
        filteredArchived.length === 0 ? (
          <EmptyState title="Nenhum arquivado" description="Nenhum produto arquivado com esse filtro." />
        ) : (
          filteredArchived.map((product) => (
            <ArchivedProductRow key={product.id ?? product.name} product={product} onUnarchive={onUnarchiveProduct} />
          ))
        )
      ) : (
        <ProductList
          products={filteredProducts}
          isReady={isProductsReady}
          hasFilters={searchTerm.trim().length > 0 || selectedCategory !== 'Todos' || onlyNeedsRestock}
          priceSummaries={priceSummaries}
          onAdd={onAddProductToList}
          onEdit={onEditProduct}
          onRemove={onRemoveProduct}
          onChangeInventory={onChangeInventory}
          onMarkInventoryMissing={onMarkInventoryMissing}
          onConsume={onConsumeProduct}
          onRegisterPrice={onRegisterPrice}
        />
      )}
    </ScreenScroll>
  );
}

function filterProducts(products: Product[], searchTerm: string, selectedCategory: string) {
  const normalizedSearch = searchTerm.trim().toLocaleLowerCase('pt-BR');

  return products.filter((product) => {
    const matchesCategory = selectedCategory === 'Todos' || product.category === selectedCategory;
    const matchesSearch = !normalizedSearch
      || product.name.toLocaleLowerCase('pt-BR').includes(normalizedSearch)
      || (product.barcode?.includes(normalizedSearch) ?? false);

    return matchesCategory && matchesSearch;
  });
}
