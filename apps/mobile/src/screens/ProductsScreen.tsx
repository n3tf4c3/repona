// Tela do catálogo de produtos, com busca, filtros e arquivados (extraída de
// App.tsx, auditoria 2026-06-09 #12.1). O estoque (quantidades) tem tela
// própria: src/screens/EstoqueScreen.tsx.
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Pressable, Text } from 'react-native';

import { CATEGORIAS, type PriceSummary } from '@repona/core';

import { ArchivedProductRow, filterProducts, ProductList } from '../components/products';
import { ChipRow, EmptyState, Header, ScreenScroll, SearchBox } from '../components/ui';
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
  onRegisterPrice: (product: Product) => void;
  onUnarchiveProduct: (product: Product) => void;
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Todos');
  const [showArchived, setShowArchived] = useState(false);
  const filteredProducts = useMemo(
    () => filterProducts(products, searchTerm, selectedCategory),
    [products, searchTerm, selectedCategory],
  );
  const filteredArchived = useMemo(
    () => filterProducts(archivedProducts, searchTerm, selectedCategory),
    [archivedProducts, searchTerm, selectedCategory],
  );

  return (
    <ScreenScroll>
      <Header eyebrow="Catálogo da casa" title="Produtos" />
      <SearchBox placeholder="Buscar produto..." value={searchTerm} onChangeText={setSearchTerm} />
      {errorMessage ? <Text style={styles.productError}>{errorMessage}</Text> : null}
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
          hasFilters={searchTerm.trim().length > 0 || selectedCategory !== 'Todos'}
          priceSummaries={priceSummaries}
          onAdd={onAddProductToList}
          onEdit={onEditProduct}
          onRemove={onRemoveProduct}
          onRegisterPrice={onRegisterPrice}
        />
      )}
    </ScreenScroll>
  );
}
