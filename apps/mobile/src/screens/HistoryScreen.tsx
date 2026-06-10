// Tela do histórico de compras (extraída de App.tsx, auditoria 2026-06-09
// #12.1).
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';

import { estimateShoppingTotal, type PriceSummary } from '@repona/core';

import { EmptyState, Header, IconBubble, MetaLabel, ScreenScroll } from '../components/ui';
import { formatCentsBRL } from '../priceFormat';
import type { PurchaseHistoryGroup, PurchaseHistoryItem } from '../purchaseHistoryPresentation';
import { styles } from '../styles';
import { colors } from '../theme';

export function HistoryScreen({
  historyGroups,
  priceSummaries,
  isReady,
  onOpenPurchase,
}: {
  historyGroups: PurchaseHistoryGroup[];
  priceSummaries: Map<number, PriceSummary>;
  isReady: boolean;
  onOpenPurchase: (item: PurchaseHistoryItem) => void;
}) {
  return (
    <ScreenScroll>
      <Header eyebrow="Suas compras anteriores" title="Histórico" />
      {!isReady ? <EmptyState title="Carregando histórico" description="Buscando as compras finalizadas." /> : null}
      {isReady && historyGroups.length === 0 ? <EmptyState title="Nenhuma compra registrada" description="Finalize itens marcados na lista para criar o primeiro histórico." /> : null}
      {historyGroups.map((group) => (
        <View key={group.title}>
          <Text style={styles.historyGroupTitle}>{group.title}</Text>
          {group.items.map((item) => (
            <HistoryCard key={item.id} item={item} priceSummaries={priceSummaries} onOpen={onOpenPurchase} />
          ))}
        </View>
      ))}
    </ScreenScroll>
  );
}

function HistoryCard({
  item,
  priceSummaries,
  onOpen,
}: {
  item: PurchaseHistoryItem;
  priceSummaries: Map<number, PriceSummary>;
  onOpen: (item: PurchaseHistoryItem) => void;
}) {
  // Total estimado pelo último preço conhecido, como no card do web; sem preço
  // registrado, mostra a contagem de itens como antes. (auditoria 2026-06-09 #8)
  const estimate = useMemo(
    () =>
      estimateShoppingTotal(
        item.lines.map((line) => ({
          priceCents: priceSummaries.get(line.productId)?.lastCents ?? null,
          quantity: line.quantity,
        })),
      ),
    [item, priceSummaries],
  );
  const totalLabel = estimate.pricedCount > 0 ? formatCentsBRL(estimate.totalCents) : item.count;
  return (
    <Pressable style={styles.historyCard} onPress={() => onOpen(item)}>
      <View style={styles.historyCardTop}>
        <Text style={styles.historyTitle}>{item.title}</Text>
        <View style={styles.historyTopRight}>
          <Text style={styles.historyTotal}>{totalLabel}</Text>
          <MaterialCommunityIcons name="chevron-right" size={20} color={colors.ink3} />
        </View>
      </View>
      <View style={styles.historyMetaRow}>
        <MetaLabel icon="calendar-month-outline" label={item.date} />
        <MetaLabel icon="package-variant-closed" label={item.count} />
      </View>
      {item.thumbs.length || item.more ? (
        <View style={styles.thumbRow}>
          {item.thumbs.map((thumb, index) => (
            <IconBubble key={`${item.title}-${index}`} icon={thumb.icon} background={thumb.background} tint={thumb.tint} size={34} iconSize={17} />
          ))}
          {item.more ? <View style={styles.moreThumb}><Text style={styles.moreText}>{item.more}</Text></View> : null}
        </View>
      ) : null}
    </Pressable>
  );
}
