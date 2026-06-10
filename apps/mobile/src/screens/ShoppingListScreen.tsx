// Tela da lista de compras ativa + barra de finalização (extraída de App.tsx,
// auditoria 2026-06-09 #12.1).
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { PriceSummary, ShoppingTotalEstimate } from '@repona/core';

import {
  CategoryHeader,
  EmptyState,
  IconButton,
  MissingBadge,
  PriceSummaryLine,
  ProgressBar,
  ScreenScroll,
} from '../components/ui';
import { formatCentsBRL } from '../priceFormat';
import { styles } from '../styles';
import { colors } from '../theme';
import type { ShoppingItem } from '../types';

export function ShoppingListScreen({
  items,
  isReady,
  listName,
  priceSummaries,
  onBack,
  onToggleItem,
  onChangeQuantity,
  onEditQuantity,
  onRemoveItem,
  onNewList,
}: {
  items: ShoppingItem[];
  isReady: boolean;
  listName: string;
  priceSummaries: Map<number, PriceSummary>;
  onBack: () => void;
  onToggleItem: (id: number) => void;
  onChangeQuantity: (item: ShoppingItem, direction: 1 | -1) => void;
  onEditQuantity: (item: ShoppingItem) => void;
  onRemoveItem: (id: number) => void;
  onNewList: () => void;
}) {
  const checkedCount = items.filter((item) => item.checked).length;
  const grouped = useMemo(() => groupShoppingItems(items), [items]);
  const progress = items.length > 0 ? checkedCount / items.length : 0;

  function handleOpenMenu() {
    Alert.alert(listName, undefined, [
      { text: 'Criar nova lista', onPress: onNewList },
      { text: 'Fechar', style: 'cancel' },
    ]);
  }

  return (
    <ScreenScroll bottomPadding={160}>
      <View style={styles.listHeader}>
        <View style={styles.rowCenter}>
          <IconButton icon="arrow-left" onPress={onBack} />
          <View style={styles.listTitleBlock}>
            <Text style={styles.eyebrowText}>{checkedCount} de {items.length} comprados</Text>
            <Text style={styles.titleText}>{listName}</Text>
          </View>
        </View>
        <IconButton icon="dots-vertical" onPress={handleOpenMenu} />
      </View>
      <ProgressBar progress={progress} />
      {!isReady ? <EmptyState title="Carregando lista" description="Buscando os itens salvos localmente." /> : null}
      {isReady && items.length === 0 ? <EmptyState title="Lista vazia" description="Adicione produtos pelo catálogo da casa." /> : null}
      {grouped.map((group) => (
        <View key={group.category}>
          <CategoryHeader title={group.category} count={group.items.length} color={group.color} />
          {group.items.map((item) => (
            <ShoppingItemRow
              key={item.id}
              item={item}
              priceSummary={item.productId !== undefined ? priceSummaries.get(item.productId) : undefined}
              onToggle={() => onToggleItem(item.id)}
              onChangeQuantity={(direction) => onChangeQuantity(item, direction)}
              onEditQuantity={() => onEditQuantity(item)}
              onRemove={() => onRemoveItem(item.id)}
            />
          ))}
        </View>
      ))}
    </ScreenScroll>
  );
}

function ShoppingItemRow({
  item,
  priceSummary,
  onToggle,
  onChangeQuantity,
  onEditQuantity,
  onRemove,
}: {
  item: ShoppingItem;
  priceSummary?: PriceSummary;
  onToggle: () => void;
  onChangeQuantity: (direction: 1 | -1) => void;
  onEditQuantity: () => void;
  onRemove: () => void;
}) {
  return (
    <View style={styles.shoppingItem}>
      <Pressable style={styles.shoppingItemToggle} onPress={onToggle}>
        <View style={[styles.checkBox, item.checked ? styles.checkBoxDone : null]}>
          {item.checked ? <MaterialCommunityIcons name="check" size={16} color={colors.surface} /> : null}
        </View>
        <View style={styles.shoppingItemText}>
          <Text style={[styles.productName, item.checked ? styles.checkedText : null]} numberOfLines={1}>{item.name}</Text>
          {item.missing ? <MissingBadge /> : <Text style={styles.productMeta}>{item.meta}</Text>}
          {priceSummary ? <PriceSummaryLine summary={priceSummary} /> : null}
        </View>
      </Pressable>
      <View style={styles.quantityPill}>
        <Pressable style={styles.qtyButton} onPress={() => onChangeQuantity(-1)}>
          <MaterialCommunityIcons name="minus" size={14} color={colors.ink2} />
        </Pressable>
        <Pressable onPress={onEditQuantity}>
          <Text style={styles.quantityText}>{item.quantity}</Text>
        </Pressable>
        <Pressable style={styles.qtyButton} onPress={() => onChangeQuantity(1)}>
          <MaterialCommunityIcons name="plus" size={14} color={colors.ink2} />
        </Pressable>
      </View>
      <Pressable style={styles.removeItemButton} onPress={onRemove}>
        <MaterialCommunityIcons name="trash-can-outline" size={17} color={colors.coral} />
      </Pressable>
    </View>
  );
}

export function FinalizeBar({
  items,
  estimate,
  isFinalizing,
  onFinalize,
}: {
  items: ShoppingItem[];
  estimate: ShoppingTotalEstimate;
  isFinalizing: boolean;
  onFinalize: () => void;
}) {
  const checkedCount = items.filter((item) => item.checked).length;
  const disabled = isFinalizing || checkedCount === 0;
  const itemLabel = checkedCount === 1 ? 'item' : 'itens';
  const label = isFinalizing
    ? 'Finalizando...'
    : checkedCount > 0
      ? `Finalizar compra · ${checkedCount} ${itemLabel}`
      : 'Marque itens comprados';

  return (
    <SafeAreaView edges={['bottom']} style={styles.finalizeShell}>
      {estimate.pricedCount > 0 ? (
        <View style={styles.estimateRow}>
          <View>
            <Text style={styles.estimateLabel}>Total estimado</Text>
            {estimate.missingCount > 0 ? (
              <Text style={styles.estimateHint}>
                Parcial · {estimate.missingCount} sem preço
              </Text>
            ) : null}
          </View>
          <Text style={styles.estimateValue}>{formatCentsBRL(estimate.totalCents)}</Text>
        </View>
      ) : null}
      <Pressable style={[styles.finalizeButton, disabled ? styles.finalizeButtonDisabled : null]} onPress={disabled ? undefined : onFinalize}>
        <MaterialCommunityIcons name="shopping-outline" size={22} color={colors.surface} />
        <Text style={styles.finalizeText}>{label}</Text>
      </Pressable>
    </SafeAreaView>
  );
}

function groupShoppingItems(items: ShoppingItem[]) {
  return items.reduce<Array<{ category: string; color: string; items: ShoppingItem[] }>>((groups, item) => {
    const existing = groups.find((group) => group.category === item.category);
    if (existing) {
      existing.items.push(item);
    } else {
      groups.push({ category: item.category, color: item.categoryColor, items: [item] });
    }
    return groups;
  }, []);
}
