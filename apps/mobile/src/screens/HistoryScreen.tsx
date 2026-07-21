// Tela do histórico de compras (extraída de App.tsx, auditoria 2026-06-09
// #12.1).
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { ActivityIndicator, Pressable, SectionList, Text, View } from 'react-native';

import { estimateShoppingTotal, type PriceSummary } from '@repona/core';

import { EmptyState, Header, IconBubble, MetaLabel } from '../components/ui';
import { formatCentsBRL } from '../priceFormat';
import type { PurchaseHistoryGroup, PurchaseHistoryItem } from '../purchaseHistoryPresentation';
import { styles } from '../styles';
import { colors } from '../theme';

export function HistoryScreen({
  historyGroups,
  priceSummaries,
  isReady,
  hasMore,
  isLoadingMore,
  onLoadMore,
  onOpenPurchase,
}: {
  historyGroups: PurchaseHistoryGroup[];
  priceSummaries: Map<number, PriceSummary>;
  isReady: boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  onOpenPurchase: (item: PurchaseHistoryItem) => void;
}) {
  const sections = useMemo(
    () => historyGroups.map((group) => ({ title: group.title, data: group.items })),
    [historyGroups],
  );

  return (
    <SectionList
      style={styles.screen}
      contentContainerStyle={styles.historyListContent}
      sections={sections}
      keyExtractor={(item) => item.id}
      renderSectionHeader={({ section }) => (
        <Text style={styles.historyGroupTitle}>{section.title}</Text>
      )}
      renderItem={({ item }) => (
        <HistoryCard item={item} priceSummaries={priceSummaries} onOpen={onOpenPurchase} />
      )}
      ListHeaderComponent={<Header eyebrow="Suas compras anteriores" title="Histórico" />}
      ListEmptyComponent={
        !isReady ? (
          <EmptyState title="Carregando histórico" description="Buscando as compras finalizadas." />
        ) : (
          <EmptyState
            title="Nenhuma compra registrada"
            description="Finalize itens marcados na lista para criar o primeiro histórico."
          />
        )
      }
      ListFooterComponent={
        <View style={styles.historyListFooter}>
          {isLoadingMore ? <ActivityIndicator color={colors.primaryStrong} /> : null}
          {hasMore && !isLoadingMore ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Carregar compras mais antigas"
              style={styles.historyLoadMoreButton}
              onPress={onLoadMore}
            >
              <Text style={styles.historyLoadMoreText}>Carregar compras mais antigas</Text>
            </Pressable>
          ) : null}
        </View>
      }
      initialNumToRender={8}
      maxToRenderPerBatch={8}
      windowSize={7}
      stickySectionHeadersEnabled={false}
      showsVerticalScrollIndicator={false}
    />
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
