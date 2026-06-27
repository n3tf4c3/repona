// Linhas e listas de produto do catálogo (extraídas de App.tsx, auditoria
// 2026-06-09 #12.1).
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';

import type { PriceSummary } from '@repona/core';

import { styles } from '../styles';
import { colors } from '../theme';
import type { Product } from '../types';
import { EmptyState, IconBubble, PriceSummaryLine } from './ui';

export function ProductRow({
  product,
  priceSummary,
  onAdd,
  onEdit,
  onRemove,
  onChangeInventory,
  onMarkInventoryMissing,
  onConsume,
  onRegisterPrice,
}: {
  product: Product;
  priceSummary?: PriceSummary;
  onAdd: (product: Product) => void;
  onEdit?: (product: Product) => void;
  onRemove?: (product: Product) => void;
  onChangeInventory?: (product: Product, direction: 1 | -1) => void;
  onMarkInventoryMissing?: (product: Product) => void;
  onConsume?: (product: Product) => void;
  onRegisterPrice?: (product: Product) => void;
}) {
  return (
    <View style={styles.productCard}>
      <View style={styles.productHeader}>
        {product.photoUri ? (
          <Image source={{ uri: product.photoUri }} style={styles.productPhoto} />
        ) : (
          <IconBubble icon={product.icon} background={product.background} tint={product.tint} size={44} />
        )}
        <View style={styles.productText}>
          <View style={styles.productNameRow}>
            <Text style={[styles.productName, styles.productNameFlex]} numberOfLines={2}>{product.name}</Text>
            {product.occasional ? <Text style={styles.eventualBadge}>Eventual</Text> : null}
          </View>
          <Text style={styles.productMeta} numberOfLines={2}>{product.meta}</Text>
          {priceSummary ? <PriceSummaryLine summary={priceSummary} /> : null}
          {onChangeInventory && onMarkInventoryMissing && onConsume ? (
            <InventoryControls product={product} onChange={onChangeInventory} onMarkMissing={onMarkInventoryMissing} onConsume={onConsume} />
          ) : null}
        </View>
      </View>
      <View style={styles.productActions}>
        {onRegisterPrice ? (
          <Pressable style={styles.productActionButton} onPress={() => onRegisterPrice(product)}>
            <MaterialCommunityIcons name="cash-multiple" size={17} color={colors.primaryStrong} />
          </Pressable>
        ) : null}
        {onEdit ? (
          <Pressable style={styles.productActionButton} onPress={() => onEdit(product)}>
            <MaterialCommunityIcons name="pencil-outline" size={17} color={colors.ink2} />
          </Pressable>
        ) : null}
        {onRemove ? (
          <Pressable style={[styles.productActionButton, styles.productDeleteButton]} onPress={() => onRemove(product)}>
            <MaterialCommunityIcons name="trash-can-outline" size={17} color={colors.coral} />
          </Pressable>
        ) : null}
        <Pressable style={styles.addMini} onPress={() => onAdd(product)}>
          <MaterialCommunityIcons name="plus" size={18} color={colors.primaryStrong} />
        </Pressable>
      </View>
    </View>
  );
}

// Linha compacta da tela Estoque: só nome e controles de quantidade, sem as
// ações de catálogo — cabe mais itens por tela.
export function EstoqueRow({
  product,
  onAdd,
  onChangeInventory,
  onMarkInventoryMissing,
  onConsume,
}: {
  product: Product;
  onAdd: (product: Product) => void;
  onChangeInventory: (product: Product, direction: 1 | -1) => void;
  onMarkInventoryMissing: (product: Product) => void;
  onConsume: (product: Product) => void;
}) {
  return (
    <View style={styles.estoqueCard}>
      {product.photoUri ? (
        <Image source={{ uri: product.photoUri }} style={styles.estoquePhoto} />
      ) : (
        <IconBubble icon={product.icon} background={product.background} tint={product.tint} size={34} />
      )}
      <View style={styles.productText}>
        <Text style={styles.productName} numberOfLines={1}>{product.name}</Text>
        <InventoryControls
          product={product}
          onChange={onChangeInventory}
          onMarkMissing={onMarkInventoryMissing}
          onConsume={onConsume}
        />
      </View>
      <Pressable style={styles.addMini} onPress={() => onAdd(product)}>
        <MaterialCommunityIcons name="plus" size={18} color={colors.primaryStrong} />
      </Pressable>
    </View>
  );
}

export function InventoryControls({
  product,
  onChange,
  onMarkMissing,
  onConsume,
}: {
  product: Product;
  onChange: (product: Product, direction: 1 | -1) => void | Promise<void>;
  onMarkMissing: (product: Product) => void | Promise<void>;
  onConsume: (product: Product) => void | Promise<void>;
}) {
  const isMissing = product.inventoryStatus === 'missing';
  // Serializa as ações deste produto: enquanto uma estiver em andamento (até o
  // refresh do estado), os botões ficam travados. Sem isso, dois toques rápidos
  // calculavam a próxima quantidade a partir do mesmo valor stale, perdendo
  // incrementos ou registrando dois consumos com uma só baixa. (auditoria #39)
  const [busy, setBusy] = useState(false);
  function run(fn: () => void | Promise<void>) {
    if (busy) return;
    setBusy(true);
    void Promise.resolve(fn()).finally(() => setBusy(false));
  }

  return (
    <View style={styles.inventoryControls}>
      <View style={[styles.inventoryQuantityPill, isMissing ? styles.inventoryMissingPill : null]}>
        <Pressable style={styles.inventoryMiniButton} disabled={busy} onPress={() => run(() => onChange(product, -1))}>
          <MaterialCommunityIcons name="minus" size={13} color={colors.ink2} />
        </Pressable>
        <Text style={styles.inventoryQuantityText}>{product.inventoryQuantity ?? '0 un'}</Text>
        <Pressable style={styles.inventoryMiniButton} disabled={busy} onPress={() => run(() => onChange(product, 1))}>
          <MaterialCommunityIcons name="plus" size={13} color={colors.ink2} />
        </Pressable>
      </View>
      <Pressable
        style={[styles.inventoryMissingButton, isMissing ? styles.inventoryMissingButtonActive : null]}
        disabled={busy}
        onPress={() => run(() => onMarkMissing(product))}
      >
        <Text style={[styles.inventoryMissingButtonText, isMissing ? styles.inventoryMissingButtonTextActive : null]}>
          {isMissing ? 'Em falta' : 'Falta'}
        </Text>
      </Pressable>
      <Pressable
        style={[styles.inventoryConsumeButton, isMissing ? styles.inventoryConsumeButtonDisabled : null]}
        disabled={isMissing || busy}
        onPress={() => run(() => onConsume(product))}
      >
        <Text style={styles.inventoryConsumeButtonText}>{isMissing ? 'Sem estoque' : 'Consumir'}</Text>
      </Pressable>
      {product.alertThreshold ? <Text style={styles.inventoryThresholdText}>Alerta {product.alertThreshold}</Text> : null}
    </View>
  );
}

export function ProductListPreview({
  products,
  isReady,
  onAdd,
}: {
  products: Product[];
  isReady: boolean;
  onAdd: (product: Product) => void;
}) {
  if (!isReady) {
    return <EmptyState title="Preparando catálogo" description="Carregando os produtos salvos da casa." />;
  }

  if (products.length === 0) {
    return <EmptyState title="Nenhum produto ainda" description="Cadastre o primeiro item para montar sua lista mais rápido." />;
  }

  return products.map((product) => (
    <ProductRow key={product.id ?? product.name} product={product} onAdd={onAdd} />
  ));
}

export function ProductList({
  products,
  isReady,
  hasFilters,
  priceSummaries,
  onAdd,
  onEdit,
  onRemove,
  onChangeInventory,
  onMarkInventoryMissing,
  onConsume,
  onRegisterPrice,
}: {
  products: Product[];
  isReady: boolean;
  hasFilters: boolean;
  priceSummaries: Map<number, PriceSummary>;
  onAdd: (product: Product) => void;
  onEdit: (product: Product) => void;
  onRemove: (product: Product) => void;
  onChangeInventory?: (product: Product, direction: 1 | -1) => void;
  onMarkInventoryMissing?: (product: Product) => void;
  onConsume?: (product: Product) => void;
  onRegisterPrice: (product: Product) => void;
}) {
  if (!isReady) {
    return <EmptyState title="Carregando produtos" description="Buscando o catálogo salvo localmente." />;
  }

  if (products.length === 0) {
    if (hasFilters) {
      return <EmptyState title="Nenhum resultado" description="Tente outro nome ou categoria." />;
    }

    return <EmptyState title="Catálogo vazio" description="Toque no botão central para cadastrar seu primeiro produto." />;
  }

  return products.map((product) => (
    <ProductRow
      key={product.id ?? product.name}
      product={product}
      priceSummary={product.id !== undefined ? priceSummaries.get(product.id) : undefined}
      onAdd={onAdd}
      onEdit={onEdit}
      onRemove={onRemove}
      onChangeInventory={onChangeInventory}
      onMarkInventoryMissing={onMarkInventoryMissing}
      onConsume={onConsume}
      onRegisterPrice={onRegisterPrice}
    />
  ));
}

// Filtro por nome/código e categoria, compartilhado entre Produtos e Estoque.
export function filterProducts(products: Product[], searchTerm: string, selectedCategory: string) {
  const normalizedSearch = searchTerm.trim().toLocaleLowerCase('pt-BR');

  return products.filter((product) => {
    const matchesCategory = selectedCategory === 'Todos' || product.category === selectedCategory;
    const matchesSearch = !normalizedSearch
      || product.name.toLocaleLowerCase('pt-BR').includes(normalizedSearch)
      || (product.barcode?.includes(normalizedSearch) ?? false);

    return matchesCategory && matchesSearch;
  });
}

export function ArchivedProductRow({ product, onUnarchive }: { product: Product; onUnarchive: (product: Product) => void }) {
  return (
    <View style={styles.productRow}>
      {product.photoUri ? (
        <Image source={{ uri: product.photoUri }} style={styles.productPhoto} />
      ) : (
        <IconBubble icon={product.icon} background={product.background} tint={product.tint} size={44} />
      )}
      <View style={styles.productText}>
        <Text style={styles.productName} numberOfLines={1}>{product.name}</Text>
        <Text style={styles.productMeta} numberOfLines={1}>{product.category ?? 'Mercearia'} · arquivado</Text>
      </View>
      <Pressable style={styles.unarchiveButton} onPress={() => onUnarchive(product)}>
        <MaterialCommunityIcons name="archive-arrow-up-outline" size={16} color={colors.primaryStrong} />
        <Text style={styles.unarchiveText}>Desarquivar</Text>
      </Pressable>
    </View>
  );
}
