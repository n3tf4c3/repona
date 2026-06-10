// Tela Início: lista ativa, ações rápidas, alertas de estoque e sugestão de
// recompra (extraída de App.tsx, auditoria 2026-06-09 #12.1).
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Alert, Pressable, Text, View } from 'react-native';

import { ProductListPreview } from '../components/products';
import {
  Header,
  IconBubble,
  IconButton,
  ProgressBar,
  ScreenScroll,
  SectionTitle,
  StatusPill,
} from '../components/ui';
import { styles } from '../styles';
import { colors } from '../theme';
import type { IconName, InventoryAlert, Product, RebuySuggestion } from '../types';

export function HomeScreen({
  onOpenList,
  onOpenHistory,
  onOpenProducts,
  onNewProduct,
  onNewList,
  onAddProductToList,
  onAddSuggestionToList,
  products,
  isProductsReady,
  inventoryAlerts,
  rebuySuggestion,
  activeListName,
  checkedCount,
  totalCount,
}: {
  onOpenList: () => void;
  onOpenHistory: () => void;
  onOpenProducts: () => void;
  onNewProduct: () => void;
  onNewList: () => void;
  onAddProductToList: (product: Product) => void;
  onAddSuggestionToList: (product: Product) => void;
  products: Product[];
  isProductsReady: boolean;
  inventoryAlerts: InventoryAlert[];
  rebuySuggestion: RebuySuggestion | null;
  activeListName: string;
  checkedCount: number;
  totalCount: number;
}) {
  const todayLabel = formatTodayLabel();

  function handleShowAlerts() {
    if (inventoryAlerts.length === 0) {
      Alert.alert('Alertas de estoque', 'Tudo em dia — nada em falta ou baixo agora.');
      return;
    }
    const linhas = inventoryAlerts.map((alert) => `• ${alert.product.name}: ${alert.description}`).join('\n\n');
    Alert.alert('Alertas de estoque', linhas);
  }

  return (
    <ScreenScroll>
      <Header
        eyebrow={todayLabel}
        title="Olá"
        actions={
          <>
            <IconButton icon="magnify" onPress={onOpenProducts} />
            <IconButton icon="bell-outline" badge={inventoryAlerts.length > 0} onPress={handleShowAlerts} />
          </>
        }
      />
      <ActiveListCard title={activeListName} checkedCount={checkedCount} totalCount={totalCount} onOpen={onOpenList} />
      <QuickActions onNewProduct={onNewProduct} onNewList={onNewList} onHistory={onOpenHistory} />
      <InventoryAlertsCard alerts={inventoryAlerts} isReady={isProductsReady} onOpenProducts={onOpenProducts} />
      <SuggestionCard suggestion={rebuySuggestion} onAdd={onAddSuggestionToList} />
      <SectionTitle title="Você costuma comprar" action="Ver tudo" onAction={onOpenProducts} />
      <ProductListPreview products={products} isReady={isProductsReady} onAdd={onAddProductToList} />
    </ScreenScroll>
  );
}

function ActiveListCard({
  title,
  checkedCount,
  totalCount,
  onOpen,
}: {
  title: string;
  checkedCount: number;
  totalCount: number;
  onOpen: () => void;
}) {
  const progress = totalCount > 0 ? checkedCount / totalCount : 0;
  const progressLabel = Math.round(progress * 100);

  return (
    <View style={styles.activeCard}>
      <View style={styles.activeTop}>
        <View>
          <StatusPill label="Lista ativa" background={colors.primarySoft} tint={colors.primaryStrong} />
          <Text style={styles.activeTitle}>{title}</Text>
          <Text style={styles.subtleText}>{checkedCount} de {totalCount} itens comprados</Text>
        </View>
        <View style={styles.ring}>
          <Text style={styles.ringText}>{progressLabel}%</Text>
        </View>
      </View>
      <ProgressBar progress={progress} />
      <View style={styles.activeFooter}>
        <View>
          <Text style={styles.subtleText}>Itens</Text>
          <Text style={styles.estimateText}>{totalCount}</Text>
        </View>
        <Pressable style={styles.blackButton} onPress={onOpen}>
          <MaterialCommunityIcons name="arrow-right" size={16} color={colors.surface} />
          <Text style={styles.blackButtonText}>Abrir lista</Text>
        </Pressable>
      </View>
    </View>
  );
}

function QuickActions({
  onNewProduct,
  onNewList,
  onHistory,
}: {
  onNewProduct: () => void;
  onNewList: () => void;
  onHistory: () => void;
}) {
  return (
    <View style={styles.quickActions}>
      <QuickAction label="Produto" icon="plus" background={colors.primarySoft} tint={colors.primaryStrong} onPress={onNewProduct} />
      <QuickAction label="Nova lista" icon="format-list-bulleted-square" background={colors.amberSoft} tint={colors.amber} onPress={onNewList} />
      <QuickAction label="Histórico" icon="clock-outline" background={colors.indigoSoft} tint={colors.indigo} onPress={onHistory} />
    </View>
  );
}

function QuickAction({
  label,
  icon,
  background,
  tint,
  onPress,
}: {
  label: string;
  icon: IconName;
  background: string;
  tint: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.quickActionCard} onPress={onPress}>
      <IconBubble icon={icon} background={background} tint={tint} size={38} />
      <Text style={styles.quickActionText}>{label}</Text>
    </Pressable>
  );
}

function InventoryAlertsCard({
  alerts,
  isReady,
  onOpenProducts,
}: {
  alerts: InventoryAlert[];
  isReady: boolean;
  onOpenProducts: () => void;
}) {
  if (!isReady) {
    return (
      <View style={styles.inventoryAlertCardOk}>
        <IconBubble icon="home-search-outline" background={colors.primarySoft} tint={colors.primaryStrong} size={42} />
        <View style={styles.inventoryAlertTextBlock}>
          <Text style={styles.inventoryAlertOkLabel}>Verificando estoque</Text>
          <Text style={styles.subtleText}>Buscando os itens salvos localmente.</Text>
        </View>
      </View>
    );
  }

  if (alerts.length === 0) {
    return (
      <View style={styles.inventoryAlertCardOk}>
        <IconBubble icon="check-circle-outline" background={colors.primarySoft} tint={colors.primaryStrong} size={42} />
        <View style={styles.inventoryAlertTextBlock}>
          <Text style={styles.inventoryAlertOkLabel}>Estoque em dia</Text>
          <Text style={styles.subtleText}>Nenhum item em falta ou baixo agora.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.inventoryAlertCard}>
      <View style={styles.inventoryAlertHeader}>
        <View>
          <Text style={styles.inventoryAlertLabel}>Alertas de estoque</Text>
          <Text style={styles.inventoryAlertTitle}>{alerts.length} {alerts.length === 1 ? 'item precisa' : 'itens precisam'} de atenção</Text>
        </View>
        <Pressable style={styles.inventoryAlertAction} onPress={onOpenProducts}>
          <Text style={styles.inventoryAlertActionText}>Ver</Text>
        </Pressable>
      </View>
      {alerts.slice(0, 3).map((alert) => (
        <View key={alert.id} style={styles.inventoryAlertRow}>
          <View style={[styles.inventoryAlertDot, alert.level === 'missing' ? styles.inventoryAlertDotMissing : null]} />
          <View style={styles.inventoryAlertTextBlock}>
            <Text style={styles.inventoryAlertItemName}>{alert.product.name}</Text>
            <Text style={styles.subtleText}>{alert.description}</Text>
          </View>
          <Text style={[styles.inventoryAlertBadge, alert.level === 'missing' ? styles.inventoryAlertBadgeMissing : null]}>{alert.label}</Text>
        </View>
      ))}
    </View>
  );
}

function SuggestionCard({ suggestion, onAdd }: { suggestion: RebuySuggestion | null; onAdd: (product: Product) => void }) {
  const disabled = !suggestion;

  return (
    <View style={styles.suggestionCard}>
      <IconBubble
        icon={suggestion?.product.icon ?? 'auto-fix'}
        background={suggestion?.product.background ?? colors.indigoSoft}
        tint={suggestion?.product.tint ?? colors.indigo}
        size={44}
      />
      <View style={styles.suggestionText}>
        <Text style={styles.suggestionLabel}>{suggestion?.badge ?? 'Sugestão de recompra'}</Text>
        <Text style={styles.suggestionTitle}>{suggestion?.title ?? 'Sem recompra sugerida agora'}</Text>
        <Text style={styles.subtleText}>{suggestion?.description ?? 'Estoque e lista ativa não indicam reposição imediata.'}</Text>
      </View>
      <Pressable
        style={[styles.suggestionAdd, disabled ? styles.suggestionAddDisabled : null]}
        disabled={disabled}
        onPress={suggestion ? () => onAdd(suggestion.product) : undefined}
      >
        <MaterialCommunityIcons name="plus" size={20} color={colors.surface} />
      </Pressable>
    </View>
  );
}

function formatTodayLabel() {
  const label = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());
  return label.charAt(0).toUpperCase() + label.slice(1);
}
