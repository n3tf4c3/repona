import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import type { BarcodeScanningResult } from 'expo-camera';
import { StatusBar } from 'expo-status-bar';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { futureFeatures } from './src/data';
import { productRecordToProduct } from './src/productPresentation';
import { purchaseHistoryRecordsToGroups } from './src/purchaseHistoryPresentation';
import type { PurchaseHistoryGroup, PurchaseHistoryItem } from './src/purchaseHistoryPresentation';
import { shoppingListRecordToItem } from './src/shoppingListPresentation';
import {
  addProductToActiveShoppingList,
  createNewActiveShoppingList,
  ensureActiveShoppingList,
  finalizeActiveShoppingList,
  listActiveShoppingItems,
  removeShoppingListItem,
  seedActiveShoppingList,
  toggleShoppingListItem,
  updateShoppingListItemQuantity,
} from './src/storage/shoppingLists';
import { consumeProductInventory, markProductInventoryMissing, setProductInventoryQuantity } from './src/storage/inventory';
import { listPurchaseHistoryRecords } from './src/storage/purchaseHistory';
import { createProduct, deleteProduct, listProducts, seedInitialProducts, updateProduct } from './src/storage/products';
import { IconName, NewProductInput, Product, ShoppingItem, TabKey } from './src/types';
import { colors, radius, shadow, spacing, typography } from './src/theme';
import {
  buildInventoryAlerts,
  buildRebuySuggestion,
  getNextInventoryQuantity,
  type InventoryAlert as CoreInventoryAlert,
  type RebuySuggestion as CoreRebuySuggestion,
} from '@repona/core';

const tabs: Array<{ key: TabKey; label: string; icon: IconName }> = [
  { key: 'home', label: 'Início', icon: 'home-variant-outline' },
  { key: 'list', label: 'Listas', icon: 'format-list-checks' },
  { key: 'products', label: 'Produtos', icon: 'package-variant-closed' },
  { key: 'future', label: 'Perfil', icon: 'account-outline' },
];
const historyTab: { key: TabKey; label: string; icon: IconName } = { key: 'history', label: 'Histórico', icon: 'history' };

type InventoryAlert = CoreInventoryAlert<Product>;
type RebuySuggestion = CoreRebuySuggestion<Product>;

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('home');
  const [showNewProduct, setShowNewProduct] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [activeShoppingListName, setActiveShoppingListName] = useState('Compra da Semana');
  const [shoppingItems, setShoppingItems] = useState<ShoppingItem[]>([]);
  const [isShoppingListReady, setIsShoppingListReady] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [isProductsReady, setIsProductsReady] = useState(false);
  const [historyGroups, setHistoryGroups] = useState<PurchaseHistoryGroup[]>([]);
  const [isHistoryReady, setIsHistoryReady] = useState(false);
  const [isFinalizingPurchase, setIsFinalizingPurchase] = useState(false);
  const [productFormError, setProductFormError] = useState<string | null>(null);
  const [productActionError, setProductActionError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadInitialProducts() {
      try {
        await seedInitialProducts();
        await seedActiveShoppingList();
        const activeList = await ensureActiveShoppingList();
        const records = await listProducts();
        const listRecords = await listActiveShoppingItems();
        const historyRecords = await listPurchaseHistoryRecords();

        if (isMounted) {
          setActiveShoppingListName(activeList.name);
          setProducts(records.map(productRecordToProduct));
          setShoppingItems(listRecords.map(shoppingListRecordToItem));
          setHistoryGroups(purchaseHistoryRecordsToGroups(historyRecords));
        }
      } catch (error) {
        console.error('Failed to load app data', error);
      } finally {
        if (isMounted) {
          setIsProductsReady(true);
          setIsShoppingListReady(true);
          setIsHistoryReady(true);
        }
      }
    }

    loadInitialProducts();

    return () => {
      isMounted = false;
    };
  }, []);

  async function refreshShoppingItems() {
    const activeList = await ensureActiveShoppingList();
    const listRecords = await listActiveShoppingItems();
    setActiveShoppingListName(activeList.name);
    setShoppingItems(listRecords.map(shoppingListRecordToItem));
  }

  async function refreshProducts() {
    const records = await listProducts();
    setProducts(records.map(productRecordToProduct));
  }

  async function refreshHistory() {
    const historyRecords = await listPurchaseHistoryRecords();
    setHistoryGroups(purchaseHistoryRecordsToGroups(historyRecords));
  }

  async function toggleItem(id: number) {
    await toggleShoppingListItem(id);
    await refreshShoppingItems();
  }

  async function changeItemQuantity(item: ShoppingItem, direction: 1 | -1) {
    const nextQuantity = getNextQuantity(item.quantity, direction);
    await updateShoppingListItemQuantity(item.id, nextQuantity);
    await refreshShoppingItems();
  }

  async function removeItem(id: number) {
    await removeShoppingListItem(id);
    await refreshShoppingItems();
  }

  function openNewProduct() {
    setProductFormError(null);
    setProductActionError(null);
    setEditingProduct(null);
    setShowNewProduct(true);
  }

  function openEditProduct(product: Product) {
    setProductFormError(null);
    setProductActionError(null);
    setEditingProduct(product);
    setShowNewProduct(true);
  }

  async function handleSaveProduct(input: NewProductInput) {
    try {
      setProductFormError(null);
      setProductActionError(null);

      if (editingProduct?.id) {
        await updateProduct(editingProduct.id, input);
        await Promise.all([refreshProducts(), refreshShoppingItems(), refreshHistory()]);
      } else {
        await createProduct(input);
        await refreshProducts();
      }

      setShowNewProduct(false);
      setEditingProduct(null);
      setActiveTab('products');
    } catch (error) {
      setProductFormError(getProductErrorMessage(error));
    }
  }

  async function handleRemoveProduct(product: Product) {
    if (!product.id) {
      return;
    }

    try {
      setProductActionError(null);
      await deleteProduct(product.id);
      await Promise.all([refreshProducts(), refreshShoppingItems()]);
    } catch (error) {
      setProductActionError(getProductErrorMessage(error));
    }
  }

  function confirmRemoveProduct(product: Product) {
    Alert.alert(
      'Remover produto',
      `Remover ${product.name} do catálogo?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Remover', style: 'destructive', onPress: () => { void handleRemoveProduct(product); } },
      ],
    );
  }

  async function handleCreateNewShoppingList() {
    await createNewActiveShoppingList();
    await refreshShoppingItems();
    setActiveTab('list');
  }

  function confirmCreateNewShoppingList() {
    Alert.alert(
      'Nova lista',
      'A lista atual será preservada e uma nova lista vazia ficará ativa.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Criar lista', onPress: () => { void handleCreateNewShoppingList(); } },
      ],
    );
  }

  async function handleAddProductToList(product: Product) {
    if (!product.id) {
      return;
    }

    await addProductToActiveShoppingList(product.id);
    await refreshShoppingItems();
    setActiveTab('list');
  }

  async function handleChangeProductInventory(product: Product, direction: 1 | -1) {
    if (!product.id) {
      return;
    }

    try {
      setProductActionError(null);
      const nextQuantity = getNextInventoryQuantity(product.inventoryQuantity ?? '0 un', direction);
      await setProductInventoryQuantity(product.id, nextQuantity);
      await Promise.all([refreshProducts(), refreshShoppingItems()]);
    } catch (error) {
      console.error('Failed to update inventory', error);
      setProductActionError('Não foi possível atualizar o estoque agora.');
    }
  }

  async function handleMarkProductMissing(product: Product) {
    if (!product.id) {
      return;
    }

    try {
      setProductActionError(null);
      await markProductInventoryMissing(product.id);
      await Promise.all([refreshProducts(), refreshShoppingItems()]);
    } catch (error) {
      console.error('Failed to mark product as missing', error);
      setProductActionError('Não foi possível atualizar o estoque agora.');
    }
  }

  async function handleConsumeProduct(product: Product) {
    if (!product.id) {
      return;
    }

    try {
      setProductActionError(null);
      await consumeProductInventory(product.id, product.inventoryQuantity ?? '0 un');
      await Promise.all([refreshProducts(), refreshShoppingItems()]);
    } catch (error) {
      if (error instanceof Error && error.message === 'INVENTORY_ALREADY_MISSING') {
        setProductActionError('Esse produto já está em falta.');
        return;
      }

      console.error('Failed to consume product inventory', error);
      setProductActionError('Não foi possível registrar o consumo agora.');
    }
  }

  async function handleFinalizePurchase() {
    if (isFinalizingPurchase) {
      return;
    }

    setIsFinalizingPurchase(true);

    try {
      const finalizedCount = await finalizeActiveShoppingList();

      if (finalizedCount > 0) {
        await Promise.all([refreshShoppingItems(), refreshProducts(), refreshHistory()]);
        setActiveTab('history');
      }
    } catch (error) {
      console.error('Failed to finalize purchase', error);
    } finally {
      setIsFinalizingPurchase(false);
    }
  }

  const checkedCount = shoppingItems.filter((item) => item.checked).length;
  const inventoryAlerts = useMemo(() => buildInventoryAlerts(products), [products]);
  const rebuySuggestion = useMemo(
    () =>
      buildRebuySuggestion(
        products,
        shoppingItems
          .map((item) => item.productId)
          .filter((id): id is number => typeof id === 'number'),
      ),
    [products, shoppingItems],
  );
  const frequentProducts = useMemo(() => {
    const listedProductIds = new Set(shoppingItems.map((item) => item.productId).filter((id): id is number => typeof id === 'number'));
    return products
      .filter((product) => !product.id || !listedProductIds.has(product.id))
      .sort((a, b) => (b.purchaseCount ?? 0) - (a.purchaseCount ?? 0))
      .slice(0, 2);
  }, [products, shoppingItems]);

  return (
    <SafeAreaProvider>
      <View style={styles.appShell}>
        <StatusBar style="dark" backgroundColor={colors.bg} />
        <SafeAreaView style={styles.safeArea} edges={['top']}>
          {activeTab === 'home' ? (
            <HomeScreen
              onOpenList={() => setActiveTab('list')}
              onOpenHistory={() => setActiveTab('history')}
              onOpenProducts={() => setActiveTab('products')}
              onNewProduct={openNewProduct}
              onNewList={confirmCreateNewShoppingList}
              onAddProductToList={handleAddProductToList}
              onAddSuggestionToList={handleAddProductToList}
              products={frequentProducts}
              isProductsReady={isProductsReady}
              inventoryAlerts={inventoryAlerts}
              rebuySuggestion={rebuySuggestion}
              activeListName={activeShoppingListName}
              checkedCount={checkedCount}
              totalCount={shoppingItems.length}
            />
          ) : null}
          {activeTab === 'list' ? (
            <ShoppingListScreen
              items={shoppingItems}
              isReady={isShoppingListReady}
              listName={activeShoppingListName}
              onBack={() => setActiveTab('home')}
              onToggleItem={toggleItem}
              onChangeQuantity={changeItemQuantity}
              onRemoveItem={removeItem}
            />
          ) : null}
          {activeTab === 'products' ? (
            <ProductsScreen
              products={products}
              isProductsReady={isProductsReady}
              errorMessage={productActionError}
              onAddProductToList={handleAddProductToList}
              onEditProduct={openEditProduct}
              onRemoveProduct={confirmRemoveProduct}
              onChangeInventory={handleChangeProductInventory}
              onMarkInventoryMissing={handleMarkProductMissing}
              onConsumeProduct={handleConsumeProduct}
            />
          ) : null}
          {activeTab === 'history' ? <HistoryScreen historyGroups={historyGroups} isReady={isHistoryReady} /> : null}
          {activeTab === 'future' ? <FutureScreen /> : null}
        </SafeAreaView>

        {activeTab === 'list' ? (
          <FinalizeBar items={shoppingItems} isFinalizing={isFinalizingPurchase} onFinalize={handleFinalizePurchase} />
        ) : null}
        {activeTab !== 'list' ? (
          <BottomNavigation
            activeTab={activeTab}
            onChange={setActiveTab}
            onAdd={openNewProduct}
          />
        ) : null}

        <NewProductSheet
          visible={showNewProduct}
          product={editingProduct}
          errorMessage={productFormError}
          onClose={() => {
            setShowNewProduct(false);
            setEditingProduct(null);
          }}
          onSave={handleSaveProduct}
        />
      </View>
    </SafeAreaProvider>
  );
}

function HomeScreen({
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

  return (
    <ScreenScroll>
      <Header
        eyebrow={todayLabel}
        title="Olá"
        actions={
          <>
            <IconButton icon="magnify" />
            <IconButton icon="bell-outline" badge />
          </>
        }
      />
      <ActiveListCard title={activeListName} checkedCount={checkedCount} totalCount={totalCount} onOpen={onOpenList} />
      <QuickActions onNewProduct={onNewProduct} onNewList={onNewList} onHistory={onOpenHistory} />
      <InventoryAlertsCard alerts={inventoryAlerts} isReady={isProductsReady} onOpenProducts={onOpenProducts} />
      <SuggestionCard suggestion={rebuySuggestion} onAdd={onAddSuggestionToList} />
      <SectionTitle title="Você costuma comprar" action="Ver tudo" />
      <ProductListPreview products={products} isReady={isProductsReady} onAdd={onAddProductToList} />
    </ScreenScroll>
  );
}

function ShoppingListScreen({
  items,
  isReady,
  listName,
  onBack,
  onToggleItem,
  onChangeQuantity,
  onRemoveItem,
}: {
  items: ShoppingItem[];
  isReady: boolean;
  listName: string;
  onBack: () => void;
  onToggleItem: (id: number) => void;
  onChangeQuantity: (item: ShoppingItem, direction: 1 | -1) => void;
  onRemoveItem: (id: number) => void;
}) {
  const checkedCount = items.filter((item) => item.checked).length;
  const grouped = useMemo(() => groupShoppingItems(items), [items]);
  const progress = items.length > 0 ? checkedCount / items.length : 0;

  return (
    <ScreenScroll bottomPadding={120}>
      <View style={styles.listHeader}>
        <View style={styles.rowCenter}>
          <IconButton icon="arrow-left" onPress={onBack} />
          <View style={styles.listTitleBlock}>
            <Text style={styles.eyebrowText}>{checkedCount} de {items.length} comprados</Text>
            <Text style={styles.titleText}>{listName}</Text>
          </View>
        </View>
        <IconButton icon="dots-vertical" />
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
              onToggle={() => onToggleItem(item.id)}
              onChangeQuantity={(direction) => onChangeQuantity(item, direction)}
              onRemove={() => onRemoveItem(item.id)}
            />
          ))}
        </View>
      ))}
    </ScreenScroll>
  );
}

function ProductsScreen({
  products,
  isProductsReady,
  errorMessage,
  onAddProductToList,
  onEditProduct,
  onRemoveProduct,
  onChangeInventory,
  onMarkInventoryMissing,
  onConsumeProduct,
}: {
  products: Product[];
  isProductsReady: boolean;
  errorMessage: string | null;
  onAddProductToList: (product: Product) => void;
  onEditProduct: (product: Product) => void;
  onRemoveProduct: (product: Product) => void;
  onChangeInventory: (product: Product, direction: 1 | -1) => void;
  onMarkInventoryMissing: (product: Product) => void;
  onConsumeProduct: (product: Product) => void;
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Todos');
  const filteredProducts = useMemo(
    () => filterProducts(products, searchTerm, selectedCategory),
    [products, searchTerm, selectedCategory],
  );

  return (
    <ScreenScroll>
      <Header
        eyebrow="Catálogo da casa"
        title="Produtos"
        actions={<IconButton icon="tune-variant" />}
      />
      <SearchBox placeholder="Buscar produto..." value={searchTerm} onChangeText={setSearchTerm} />
      {errorMessage ? <Text style={styles.productError}>{errorMessage}</Text> : null}
      <ChipRow chips={['Todos', 'Mercearia', 'Hortifrúti', 'Laticínios', 'Limpeza', 'Bebidas']} selected={selectedCategory} onSelect={setSelectedCategory} />
      <ProductList
        products={filteredProducts}
        isReady={isProductsReady}
        hasFilters={searchTerm.trim().length > 0 || selectedCategory !== 'Todos'}
        onAdd={onAddProductToList}
        onEdit={onEditProduct}
        onRemove={onRemoveProduct}
        onChangeInventory={onChangeInventory}
        onMarkInventoryMissing={onMarkInventoryMissing}
        onConsume={onConsumeProduct}
      />
    </ScreenScroll>
  );
}

function HistoryScreen({
  historyGroups,
  isReady,
}: {
  historyGroups: PurchaseHistoryGroup[];
  isReady: boolean;
}) {
  return (
    <ScreenScroll>
      <Header
        eyebrow="Suas compras anteriores"
        title="Histórico"
        actions={<IconButton icon="calendar-month-outline" />}
      />
      {!isReady ? <EmptyState title="Carregando histórico" description="Buscando as compras finalizadas." /> : null}
      {isReady && historyGroups.length === 0 ? <EmptyState title="Nenhuma compra registrada" description="Finalize itens marcados na lista para criar o primeiro histórico." /> : null}
      {historyGroups.map((group) => (
        <View key={group.title}>
          <Text style={styles.historyGroupTitle}>{group.title}</Text>
          {group.items.map((item) => (
            <HistoryCard key={item.id} item={item} />
          ))}
        </View>
      ))}
    </ScreenScroll>
  );
}

function FutureScreen() {
  return (
    <ScreenScroll>
      <Header eyebrow="No horizonte" title="Casa Repona" actions={<IconButton icon="account-group-outline" />} />
      <View style={styles.futureHero}>
        <IconBubble icon="home-variant-outline" background="rgba(127,217,160,0.18)" tint="#7FD9A0" size={52} />
        <Text style={styles.futureHeroTitle}>Feito para famílias brasileiras</Text>
        <Text style={styles.futureHeroText}>
          O MVP funciona offline e já prepara espaço para estoque doméstico, scanner e compartilhamento familiar.
        </Text>
      </View>
      <SectionTitle title="Feito para crescer" />
      {futureFeatures.map((feature) => (
        <View key={feature.title} style={styles.futureCard}>
          <IconBubble icon={feature.icon} background="rgba(127,217,160,0.15)" tint="#7FD9A0" size={48} />
          <View style={styles.futureCardText}>
            <Text style={styles.futureCardTitle}>{feature.title}</Text>
            <Text style={styles.futureCardDescription}>{feature.description}</Text>
            <View style={styles.soonPill}>
              <Text style={styles.soonText}>Em breve</Text>
            </View>
          </View>
        </View>
      ))}
    </ScreenScroll>
  );
}

function ScreenScroll({ children, bottomPadding = 112 }: { children: ReactNode; bottomPadding?: number }) {
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.screenContent, { paddingBottom: bottomPadding }]}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

function Header({ eyebrow, title, actions }: { eyebrow: string; title: string; actions?: ReactNode }) {
  return (
    <View style={styles.header}>
      <View style={styles.headerText}>
        <Text style={styles.eyebrowText}>{eyebrow}</Text>
        <Text style={styles.headerTitle}>{title}</Text>
      </View>
      <View style={styles.headerActions}>{actions}</View>
    </View>
  );
}

function IconButton({
  icon,
  badge = false,
  onPress,
}: {
  icon: IconName;
  badge?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable style={styles.iconButton} onPress={onPress}>
      <MaterialCommunityIcons name={icon} size={20} color={colors.ink2} />
      {badge ? <View style={styles.notificationBadge} /> : null}
    </Pressable>
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

function SectionTitle({ title, action }: { title: string; action?: string }) {
  return (
    <View style={styles.sectionTitle}>
      <Text style={styles.sectionTitleText}>{title}</Text>
      {action ? <Text style={styles.sectionAction}>{action}</Text> : null}
    </View>
  );
}

function ProductRow({
  product,
  onAdd,
  onEdit,
  onRemove,
  onChangeInventory,
  onMarkInventoryMissing,
  onConsume,
}: {
  product: Product;
  onAdd: (product: Product) => void;
  onEdit?: (product: Product) => void;
  onRemove?: (product: Product) => void;
  onChangeInventory?: (product: Product, direction: 1 | -1) => void;
  onMarkInventoryMissing?: (product: Product) => void;
  onConsume?: (product: Product) => void;
}) {
  return (
    <View style={styles.productRow}>
      {product.photoUri ? (
        <Image source={{ uri: product.photoUri }} style={styles.productPhoto} />
      ) : (
        <IconBubble icon={product.icon} background={product.background} tint={product.tint} size={44} />
      )}
      <View style={styles.productText}>
        <Text style={styles.productName} numberOfLines={1}>{product.name}</Text>
        <Text style={styles.productMeta} numberOfLines={1}>{product.meta}</Text>
        {onChangeInventory && onMarkInventoryMissing && onConsume ? (
          <InventoryControls product={product} onChange={onChangeInventory} onMarkMissing={onMarkInventoryMissing} onConsume={onConsume} />
        ) : null}
      </View>
      <View style={styles.productActions}>
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

function InventoryControls({
  product,
  onChange,
  onMarkMissing,
  onConsume,
}: {
  product: Product;
  onChange: (product: Product, direction: 1 | -1) => void;
  onMarkMissing: (product: Product) => void;
  onConsume: (product: Product) => void;
}) {
  const isMissing = product.inventoryStatus === 'missing';

  return (
    <View style={styles.inventoryControls}>
      <View style={[styles.inventoryQuantityPill, isMissing ? styles.inventoryMissingPill : null]}>
        <Pressable style={styles.inventoryMiniButton} onPress={() => onChange(product, -1)}>
          <MaterialCommunityIcons name="minus" size={13} color={colors.ink2} />
        </Pressable>
        <Text style={styles.inventoryQuantityText}>{product.inventoryQuantity ?? '0 un'}</Text>
        <Pressable style={styles.inventoryMiniButton} onPress={() => onChange(product, 1)}>
          <MaterialCommunityIcons name="plus" size={13} color={colors.ink2} />
        </Pressable>
      </View>
      <Pressable
        style={[styles.inventoryMissingButton, isMissing ? styles.inventoryMissingButtonActive : null]}
        onPress={() => onMarkMissing(product)}
      >
        <Text style={[styles.inventoryMissingButtonText, isMissing ? styles.inventoryMissingButtonTextActive : null]}>
          {isMissing ? 'Em falta' : 'Falta'}
        </Text>
      </Pressable>
      <Pressable
        style={[styles.inventoryConsumeButton, isMissing ? styles.inventoryConsumeButtonDisabled : null]}
        disabled={isMissing}
        onPress={() => onConsume(product)}
      >
        <Text style={styles.inventoryConsumeButtonText}>{isMissing ? 'Sem estoque' : 'Consumir'}</Text>
      </Pressable>
      {product.alertThreshold ? <Text style={styles.inventoryThresholdText}>Alerta {product.alertThreshold}</Text> : null}
    </View>
  );
}

function ProductListPreview({
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

function ProductList({
  products,
  isReady,
  hasFilters,
  onAdd,
  onEdit,
  onRemove,
  onChangeInventory,
  onMarkInventoryMissing,
  onConsume,
}: {
  products: Product[];
  isReady: boolean;
  hasFilters: boolean;
  onAdd: (product: Product) => void;
  onEdit: (product: Product) => void;
  onRemove: (product: Product) => void;
  onChangeInventory: (product: Product, direction: 1 | -1) => void;
  onMarkInventoryMissing: (product: Product) => void;
  onConsume: (product: Product) => void;
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
      onAdd={onAdd}
      onEdit={onEdit}
      onRemove={onRemove}
      onChangeInventory={onChangeInventory}
      onMarkInventoryMissing={onMarkInventoryMissing}
      onConsume={onConsume}
    />
  ));
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <View style={styles.emptyCard}>
      <MaterialCommunityIcons name="basket-outline" size={24} color={colors.primaryStrong} />
      <View style={styles.emptyTextBlock}>
        <Text style={styles.emptyTitle}>{title}</Text>
        <Text style={styles.emptyDescription}>{description}</Text>
      </View>
    </View>
  );
}

function SearchBox({
  placeholder,
  value,
  onChangeText,
}: {
  placeholder: string;
  value?: string;
  onChangeText?: (value: string) => void;
}) {
  return (
    <View style={styles.searchBox}>
      <MaterialCommunityIcons name="magnify" size={20} color={colors.ink3} />
      {onChangeText ? (
        <TextInput
          value={value ?? ''}
          onChangeText={onChangeText}
          style={styles.searchInput}
          placeholder={placeholder}
          placeholderTextColor={colors.ink3}
        />
      ) : (
        <Text style={styles.searchPlaceholder}>{placeholder}</Text>
      )}
    </View>
  );
}

function ChipRow({
  chips,
  selected,
  onSelect,
}: {
  chips: string[];
  selected: string;
  onSelect?: (chip: string) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
      {chips.map((chip) => {
        const active = chip === selected;
        return (
          <Pressable key={chip} style={[styles.chip, active ? styles.chipActive : null]} onPress={() => onSelect?.(chip)}>
            <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>{chip}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function CategoryHeader({ title, count, color }: { title: string; count: number; color: string }) {
  return (
    <View style={styles.categoryHeader}>
      <View style={[styles.categoryDot, { backgroundColor: color }]} />
      <Text style={styles.categoryTitle}>{title}</Text>
      <Text style={styles.categoryCount}>{count} itens</Text>
    </View>
  );
}

function ShoppingItemRow({
  item,
  onToggle,
  onChangeQuantity,
  onRemove,
}: {
  item: ShoppingItem;
  onToggle: () => void;
  onChangeQuantity: (direction: 1 | -1) => void;
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
        </View>
      </Pressable>
      <View style={styles.quantityPill}>
        <Pressable style={styles.qtyButton} onPress={() => onChangeQuantity(-1)}>
          <MaterialCommunityIcons name="minus" size={14} color={colors.ink2} />
        </Pressable>
        <Text style={styles.quantityText}>{item.quantity}</Text>
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

function MissingBadge() {
  return (
    <View style={styles.missingBadge}>
      <MaterialCommunityIcons name="alert-circle-outline" size={13} color={colors.coral} />
      <Text style={styles.missingText}>Em falta em casa</Text>
    </View>
  );
}

function HistoryCard({ item }: { item: PurchaseHistoryItem }) {
  return (
    <View style={styles.historyCard}>
      <View style={styles.historyCardTop}>
        <Text style={styles.historyTitle}>{item.title}</Text>
        <Text style={styles.historyTotal}>{item.total}</Text>
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
    </View>
  );
}

function MetaLabel({ icon, label }: { icon: IconName; label: string }) {
  return (
    <View style={styles.metaLabel}>
      <MaterialCommunityIcons name={icon} size={14} color={colors.ink3} />
      <Text style={styles.metaLabelText}>{label}</Text>
    </View>
  );
}

function ProgressBar({ progress }: { progress: number }) {
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${Math.max(0, Math.min(progress, 1)) * 100}%` }]} />
    </View>
  );
}

function IconBubble({
  icon,
  background,
  tint,
  size,
  iconSize = 22,
}: {
  icon: IconName;
  background: string;
  tint: string;
  size: number;
  iconSize?: number;
}) {
  return (
    <View style={[styles.iconBubble, { width: size, height: size, backgroundColor: background }]}>
      <MaterialCommunityIcons name={icon} size={iconSize} color={tint} />
    </View>
  );
}

function StatusPill({ label, background, tint }: { label: string; background: string; tint: string }) {
  return (
    <View style={[styles.statusPill, { backgroundColor: background }]}>
      <Text style={[styles.statusPillText, { color: tint }]}>{label}</Text>
    </View>
  );
}

function FinalizeBar({
  items,
  isFinalizing,
  onFinalize,
}: {
  items: ShoppingItem[];
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
      <Pressable style={[styles.finalizeButton, disabled ? styles.finalizeButtonDisabled : null]} onPress={disabled ? undefined : onFinalize}>
        <MaterialCommunityIcons name="shopping-outline" size={22} color={colors.surface} />
        <Text style={styles.finalizeText}>{label}</Text>
      </Pressable>
    </SafeAreaView>
  );
}

function BottomNavigation({
  activeTab,
  onChange,
  onAdd,
}: {
  activeTab: TabKey;
  onChange: (tab: TabKey) => void;
  onAdd: () => void;
}) {
  const secondaryTab = activeTab === 'history' ? historyTab : tabs[1];

  return (
    <SafeAreaView edges={['bottom']} style={styles.bottomShell}>
      <View style={styles.bottomBar}>
        <TabButton tab={tabs[0]} active={activeTab === tabs[0].key} onPress={() => onChange(tabs[0].key)} />
        <TabButton tab={secondaryTab} active={activeTab === secondaryTab.key} onPress={() => onChange(secondaryTab.key)} />
        <Pressable style={styles.fab} onPress={onAdd}>
          <MaterialCommunityIcons name="plus" size={28} color={colors.surface} />
        </Pressable>
        <TabButton tab={tabs[2]} active={activeTab === tabs[2].key} onPress={() => onChange(tabs[2].key)} />
        <TabButton tab={tabs[3]} active={activeTab === tabs[3].key} onPress={() => onChange(tabs[3].key)} />
      </View>
    </SafeAreaView>
  );
}

function TabButton({
  tab,
  active,
  onPress,
}: {
  tab: (typeof tabs)[number];
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.tabButton} onPress={onPress}>
      <MaterialCommunityIcons name={tab.icon} size={23} color={active ? colors.primaryStrong : colors.ink3} />
      <Text style={[styles.tabLabel, active ? styles.tabLabelActive : null]}>{tab.label}</Text>
    </Pressable>
  );
}

function NewProductSheet({
  visible,
  product,
  errorMessage,
  onClose,
  onSave,
}: {
  visible: boolean;
  product: Product | null;
  errorMessage: string | null;
  onClose: () => void;
  onSave: (input: NewProductInput) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Mercearia');
  const [barcode, setBarcode] = useState<string | null>(null);
  const [alertThreshold, setAlertThreshold] = useState('');
  const [barcodeError, setBarcodeError] = useState<string | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [isPhotoCameraVisible, setIsPhotoCameraVisible] = useState(false);
  const [isTakingPhoto, setIsTakingPhoto] = useState(false);
  const [isScannerVisible, setIsScannerVisible] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const photoCameraRef = useRef<CameraView>(null);

  useEffect(() => {
    if (visible) {
      setName(product?.name ?? '');
      setCategory(product?.category ?? 'Mercearia');
      setBarcode(product?.barcode ?? null);
      setAlertThreshold(product?.alertThreshold ?? '');
      setBarcodeError(null);
      setPhotoUri(product?.photoUri ?? null);
      setPhotoError(null);
      setIsPhotoCameraVisible(false);
      setIsTakingPhoto(false);
      setIsScannerVisible(false);
      setHasScanned(false);
      setIsSaving(false);
    }
  }, [product, visible]);

  async function openBarcodeScanner() {
    setBarcodeError(null);
    const permission = cameraPermission?.granted ? cameraPermission : await requestCameraPermission();

    if (!permission.granted) {
      setBarcodeError('Permita acesso à câmera para ler o código.');
      return;
    }

    setHasScanned(false);
    setIsScannerVisible(true);
  }

  async function openPhotoCamera() {
    setPhotoError(null);
    const permission = cameraPermission?.granted ? cameraPermission : await requestCameraPermission();

    if (!permission.granted) {
      setPhotoError('Permita acesso à câmera para tirar a foto.');
      return;
    }

    setIsPhotoCameraVisible(true);
  }

  async function capturePhoto() {
    if (isTakingPhoto) {
      return;
    }

    setIsTakingPhoto(true);

    try {
      const photo = await photoCameraRef.current?.takePictureAsync({ quality: 0.75 });

      if (photo?.uri) {
        setPhotoUri(photo.uri);
        setIsPhotoCameraVisible(false);
      }
    } catch (error) {
      setPhotoError('Não foi possível tirar a foto agora.');
    } finally {
      setIsTakingPhoto(false);
    }
  }

  function handleBarcodeScanned(result: BarcodeScanningResult) {
    if (hasScanned) {
      return;
    }

    setHasScanned(true);
    setBarcode(result.data);
    setIsScannerVisible(false);
  }

  async function handleSave() {
    if (isSaving) {
      return;
    }

    setIsSaving(true);
    await onSave({ name, category, barcode, photoUri, alertThreshold: alertThreshold.trim() || null });
    setIsSaving(false);
  }

  return (
    <>
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
        <Pressable style={styles.modalScrim} onPress={onClose} />
        <SafeAreaView edges={['bottom']} style={styles.sheetShell}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>{product ? 'Editar produto' : 'Novo produto'}</Text>
          <Text style={styles.sheetSubtitle}>{product ? 'Ajuste nome e categoria do produto cadastrado.' : 'Só o nome já basta. O resto é opcional.'}</Text>
          <Text style={styles.fieldLabel}>Nome do produto</Text>
          <View style={styles.inputBox}>
            <MaterialCommunityIcons name="tag-outline" size={20} color={colors.primaryStrong} />
            <TextInput
              value={name}
              onChangeText={setName}
              style={styles.input}
              placeholder="Nome do produto"
              placeholderTextColor={colors.ink3}
            />
          </View>
          {errorMessage ? <Text style={styles.formError}>{errorMessage}</Text> : null}
          <Text style={styles.fieldLabel}>Categoria</Text>
          <ChipRow chips={['Mercearia', 'Hortifrúti', 'Laticínios', 'Bebidas', 'Limpeza']} selected={category} onSelect={setCategory} />
          <Text style={styles.fieldLabel}>Alerta de estoque (opcional)</Text>
          <View style={styles.inputBox}>
            <MaterialCommunityIcons name="alert-circle-outline" size={20} color={colors.primaryStrong} />
            <TextInput
              value={alertThreshold}
              onChangeText={setAlertThreshold}
              style={styles.input}
              placeholder="Ex.: 2 un ou 500 g"
              placeholderTextColor={colors.ink3}
            />
          </View>
          {photoUri ? <Image source={{ uri: photoUri }} style={styles.sheetPhotoPreview} /> : null}
          <View style={styles.optionalRow}>
            <OptionalCapture icon="camera-outline" label={photoUri ? 'Foto anexada' : 'Foto (opcional)'} onPress={openPhotoCamera} />
            <OptionalCapture icon="barcode-scan" label={barcode ? 'Código lido' : 'Código (opcional)'} onPress={openBarcodeScanner} />
          </View>
          {photoError ? <Text style={styles.formError}>{photoError}</Text> : null}
          {barcode ? <Text style={styles.captureResult}>Código: {barcode}</Text> : null}
          {barcodeError ? <Text style={styles.formError}>{barcodeError}</Text> : null}
          <Pressable style={[styles.saveButton, isSaving ? styles.saveButtonDisabled : null]} onPress={handleSave}>
            <MaterialCommunityIcons name="check" size={20} color={colors.surface} />
            <Text style={styles.saveButtonText}>{isSaving ? 'Salvando...' : product ? 'Atualizar produto' : 'Salvar produto'}</Text>
          </Pressable>
        </SafeAreaView>
      </Modal>
      <Modal visible={isScannerVisible} animationType="slide" onRequestClose={() => setIsScannerVisible(false)}>
        <SafeAreaView edges={['top', 'bottom']} style={styles.scannerShell}>
          <View style={styles.scannerHeader}>
            <View>
              <Text style={styles.scannerTitle}>Ler código</Text>
              <Text style={styles.scannerSubtitle}>Aponte a câmera para o código de barras.</Text>
            </View>
            <Pressable style={styles.scannerClose} onPress={() => setIsScannerVisible(false)}>
              <MaterialCommunityIcons name="close" size={22} color={colors.surface} />
            </Pressable>
          </View>
          <CameraView
            style={styles.scannerCamera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39'] }}
            onBarcodeScanned={hasScanned ? undefined : handleBarcodeScanned}
          />
          <Text style={styles.scannerHint}>O código será anexado ao cadastro do produto.</Text>
        </SafeAreaView>
      </Modal>
      <Modal visible={isPhotoCameraVisible} animationType="slide" onRequestClose={() => setIsPhotoCameraVisible(false)}>
        <SafeAreaView edges={['top', 'bottom']} style={styles.scannerShell}>
          <View style={styles.scannerHeader}>
            <View>
              <Text style={styles.scannerTitle}>Foto do produto</Text>
              <Text style={styles.scannerSubtitle}>Centralize a embalagem e tire uma foto simples.</Text>
            </View>
            <Pressable style={styles.scannerClose} onPress={() => setIsPhotoCameraVisible(false)}>
              <MaterialCommunityIcons name="close" size={22} color={colors.surface} />
            </Pressable>
          </View>
          <CameraView ref={photoCameraRef} style={styles.scannerCamera} facing="back" />
          <View style={styles.photoCaptureBar}>
            <Pressable style={styles.photoCaptureButton} onPress={capturePhoto}>
              <View style={styles.photoCaptureButtonInner} />
            </Pressable>
            <Text style={styles.scannerHint}>{isTakingPhoto ? 'Salvando foto...' : 'Toque para capturar a foto.'}</Text>
          </View>
        </SafeAreaView>
      </Modal>
    </>
  );
}

function OptionalCapture({ icon, label, onPress }: { icon: IconName; label: string; onPress?: () => void }) {
  const content = (
    <>
      <MaterialCommunityIcons name={icon} size={22} color={colors.ink3} />
      <Text style={styles.optionalText}>{label}</Text>
    </>
  );

  if (onPress) {
    return (
      <Pressable style={styles.optionalCapture} onPress={onPress}>
        {content}
      </Pressable>
    );
  }

  return (
    <View style={styles.optionalCapture}>
      {content}
    </View>
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

function getProductErrorMessage(error: unknown) {
  if (error instanceof Error) {
    if (error.message === 'PRODUCT_NAME_REQUIRED') {
      return 'Informe o nome do produto.';
    }

    if (error.message === 'PRODUCT_ALREADY_EXISTS') {
      return 'Esse produto já está cadastrado.';
    }

    if (error.message === 'PRODUCT_HAS_HISTORY') {
      return 'Não é possível remover produto com histórico de compras.';
    }

    if (error.message === 'PRODUCT_NOT_FOUND') {
      return 'Produto não encontrado.';
    }
  }

  return 'Não foi possível salvar o produto agora.';
}

function formatTodayLabel() {
  const label = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function getNextQuantity(quantity: string, direction: 1 | -1) {
  const match = quantity.match(/^(\d+(?:[.,]\d+)?)\s*(.*)$/);

  if (!match) {
    return direction > 0 ? '2 un' : '1 un';
  }

  const currentValue = Number(match[1].replace(',', '.'));
  const unit = match[2].trim() || 'un';
  const step = unit === 'g' ? 100 : 1;
  const min = unit === 'g' ? 100 : 1;
  const nextValue = Math.max(min, currentValue + direction * step);
  const formattedValue = Number.isInteger(nextValue) ? `${nextValue}` : `${nextValue.toFixed(1).replace('.', ',')}`;

  return `${formattedValue} ${unit}`;
}

const styles = StyleSheet.create({
  appShell: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  safeArea: {
    flex: 1,
  },
  screen: {
    flex: 1,
  },
  screenContent: {
    paddingHorizontal: spacing.screen,
    paddingTop: 18,
    gap: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  headerText: {
    flex: 1,
  },
  eyebrowText: {
    ...typography.label,
    color: colors.ink3,
  },
  headerTitle: {
    ...typography.h1,
    color: colors.ink,
  },
  titleText: {
    ...typography.h2,
    color: colors.ink,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 9,
  },
  rowCenter: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.small,
  },
  notificationBadge: {
    position: 'absolute',
    top: 8,
    right: 9,
    width: 8,
    height: 8,
    borderRadius: 8,
    backgroundColor: colors.coral,
    borderWidth: 1,
    borderColor: colors.surface,
  },
  activeCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.line2,
    padding: 18,
    ...shadow.small,
  },
  activeTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  activeTitle: {
    ...typography.h2,
    color: colors.ink,
    marginTop: 9,
  },
  subtleText: {
    ...typography.bodySmall,
    color: colors.ink3,
  },
  ring: {
    width: 64,
    height: 64,
    borderRadius: 64,
    borderWidth: 8,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  ringText: {
    ...typography.labelStrong,
    color: colors.ink,
  },
  progressTrack: {
    height: 9,
    borderRadius: 9,
    backgroundColor: colors.bg2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 9,
    backgroundColor: colors.primary,
  },
  activeFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  estimateText: {
    ...typography.h3,
    color: colors.ink,
  },
  blackButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.ink,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  blackButtonText: {
    ...typography.labelStrong,
    color: colors.surface,
  },
  statusPill: {
    alignSelf: 'flex-start',
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  statusPillText: {
    ...typography.badge,
  },
  quickActions: {
    flexDirection: 'row',
    gap: 9,
  },
  quickActionCard: {
    flex: 1,
    alignItems: 'center',
    gap: 7,
    backgroundColor: colors.surface,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: colors.line2,
    paddingVertical: 13,
    ...shadow.small,
  },
  quickActionText: {
    ...typography.label,
    color: colors.ink2,
  },
  iconBubble: {
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inventoryAlertCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.coralSoft,
    padding: 15,
    gap: 11,
    ...shadow.small,
  },
  inventoryAlertCardOk: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.primarySoft,
    padding: 14,
    ...shadow.small,
  },
  inventoryAlertHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  inventoryAlertLabel: {
    ...typography.badge,
    color: colors.coral,
    textTransform: 'uppercase',
  },
  inventoryAlertOkLabel: {
    ...typography.badge,
    color: colors.primaryStrong,
    textTransform: 'uppercase',
  },
  inventoryAlertTitle: {
    ...typography.labelStrong,
    color: colors.ink,
    marginTop: 2,
  },
  inventoryAlertAction: {
    borderRadius: 10,
    backgroundColor: colors.coralSoft,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  inventoryAlertActionText: {
    ...typography.badge,
    color: colors.coral,
  },
  inventoryAlertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderTopWidth: 1,
    borderTopColor: colors.line2,
    paddingTop: 10,
  },
  inventoryAlertDot: {
    width: 9,
    height: 9,
    borderRadius: 9,
    backgroundColor: colors.amber,
  },
  inventoryAlertDotMissing: {
    backgroundColor: colors.coral,
  },
  inventoryAlertTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  inventoryAlertItemName: {
    ...typography.labelStrong,
    color: colors.ink,
  },
  inventoryAlertBadge: {
    ...typography.badge,
    color: colors.amber,
    backgroundColor: colors.amberSoft,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  inventoryAlertBadgeMissing: {
    color: colors.coral,
    backgroundColor: colors.coralSoft,
  },
  suggestionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.indigoSoft,
    padding: 14,
    ...shadow.small,
  },
  suggestionText: {
    flex: 1,
  },
  suggestionLabel: {
    ...typography.badge,
    color: colors.indigo,
    textTransform: 'uppercase',
  },
  suggestionTitle: {
    ...typography.labelStrong,
    color: colors.ink,
  },
  suggestionAdd: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: colors.indigo,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionAddDisabled: {
    opacity: 0.45,
  },
  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  sectionTitleText: {
    ...typography.h3,
    color: colors.ink,
  },
  sectionAction: {
    ...typography.labelStrong,
    color: colors.primaryStrong,
  },
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    backgroundColor: colors.surface,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: colors.line2,
    paddingHorizontal: 13,
    paddingVertical: 11,
    ...shadow.small,
  },
  productPhoto: {
    width: 44,
    height: 44,
    borderRadius: 13,
    backgroundColor: colors.bg2,
  },
  productText: {
    flex: 1,
    minWidth: 0,
  },
  productName: {
    ...typography.labelStrong,
    color: colors.ink,
  },
  productMeta: {
    ...typography.bodySmall,
    color: colors.ink3,
  },
  inventoryControls: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 7,
  },
  inventoryQuantityPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bg,
    padding: 3,
  },
  inventoryMissingPill: {
    borderColor: colors.coralSoft,
    backgroundColor: colors.coralSoft,
  },
  inventoryMiniButton: {
    width: 22,
    height: 22,
    borderRadius: 8,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inventoryQuantityText: {
    ...typography.badge,
    color: colors.ink,
    minWidth: 34,
    textAlign: 'center',
  },
  inventoryMissingButton: {
    alignSelf: 'flex-start',
    borderRadius: 9,
    backgroundColor: colors.bg2,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  inventoryMissingButtonActive: {
    backgroundColor: colors.coralSoft,
  },
  inventoryMissingButtonText: {
    ...typography.badge,
    color: colors.ink2,
  },
  inventoryMissingButtonTextActive: {
    color: colors.coral,
  },
  inventoryConsumeButton: {
    alignSelf: 'flex-start',
    borderRadius: 9,
    backgroundColor: colors.primarySoft,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  inventoryConsumeButtonDisabled: {
    opacity: 0.58,
  },
  inventoryConsumeButtonText: {
    ...typography.badge,
    color: colors.primaryStrong,
  },
  inventoryThresholdText: {
    ...typography.badge,
    alignSelf: 'center',
    color: colors.ink3,
  },
  productActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  productActionButton: {
    width: 32,
    height: 32,
    borderRadius: 11,
    backgroundColor: colors.bg2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  productDeleteButton: {
    backgroundColor: colors.coralSoft,
  },
  productError: {
    ...typography.labelStrong,
    color: colors.coral,
    backgroundColor: colors.coralSoft,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  addMini: {
    width: 32,
    height: 32,
    borderRadius: 11,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.line2,
    padding: 16,
    ...shadow.small,
  },
  emptyTextBlock: {
    flex: 1,
    gap: 2,
  },
  emptyTitle: {
    ...typography.labelStrong,
    color: colors.ink,
  },
  emptyDescription: {
    ...typography.bodySmall,
    color: colors.ink3,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 14,
    paddingVertical: 13,
    ...shadow.small,
  },
  searchPlaceholder: {
    ...typography.body,
    color: colors.ink3,
  },
  searchInput: {
    flex: 1,
    ...typography.body,
    color: colors.ink,
    paddingVertical: 0,
  },
  chipRow: {
    gap: 8,
  },
  chip: {
    borderRadius: 100,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipActive: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },
  chipText: {
    ...typography.labelStrong,
    color: colors.ink2,
  },
  chipTextActive: {
    color: colors.surface,
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  listTitleBlock: {
    marginLeft: 10,
  },
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
    marginBottom: 9,
  },
  categoryDot: {
    width: 8,
    height: 8,
    borderRadius: 8,
  },
  categoryTitle: {
    ...typography.labelStrong,
    color: colors.ink2,
    flex: 1,
  },
  categoryCount: {
    ...typography.label,
    color: colors.ink3,
  },
  shoppingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line2,
    paddingHorizontal: 13,
    paddingVertical: 11,
    marginBottom: 7,
    ...shadow.small,
  },
  shoppingItemToggle: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minWidth: 0,
  },
  checkBox: {
    width: 26,
    height: 26,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBoxDone: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  shoppingItemText: {
    flex: 1,
  },
  checkedText: {
    color: colors.ink3,
    textDecorationLine: 'line-through',
  },
  quantityPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: colors.bg,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 4,
  },
  qtyButton: {
    width: 24,
    height: 24,
    borderRadius: 8,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quantityText: {
    ...typography.labelStrong,
    color: colors.ink,
    minWidth: 40,
    textAlign: 'center',
  },
  removeItemButton: {
    width: 32,
    height: 32,
    borderRadius: 11,
    backgroundColor: colors.coralSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  missingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    marginTop: 4,
    backgroundColor: colors.coralSoft,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  missingText: {
    ...typography.badge,
    color: colors.coral,
  },
  historyGroupTitle: {
    ...typography.labelStrong,
    color: colors.ink3,
    marginTop: 8,
    marginBottom: 8,
  },
  historyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.line2,
    padding: 14,
    marginBottom: 9,
    ...shadow.small,
  },
  historyCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  historyTitle: {
    ...typography.h3,
    color: colors.ink,
  },
  historyTotal: {
    ...typography.h3,
    color: colors.primaryStrong,
  },
  historyMetaRow: {
    flexDirection: 'row',
    gap: 12,
  },
  metaLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  metaLabelText: {
    ...typography.label,
    color: colors.ink3,
  },
  thumbRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 11,
  },
  moreThumb: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: colors.bg2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreText: {
    ...typography.labelStrong,
    color: colors.ink2,
  },
  futureHero: {
    backgroundColor: colors.ink,
    borderRadius: radius.card,
    padding: 22,
    gap: 12,
  },
  futureHeroTitle: {
    ...typography.h2,
    color: colors.surface,
  },
  futureHeroText: {
    ...typography.body,
    color: 'rgba(255,255,255,0.72)',
  },
  futureCard: {
    flexDirection: 'row',
    gap: 14,
    backgroundColor: colors.ink,
    borderRadius: radius.card,
    padding: 18,
  },
  futureCardText: {
    flex: 1,
    gap: 5,
  },
  futureCardTitle: {
    ...typography.h3,
    color: colors.surface,
  },
  futureCardDescription: {
    ...typography.body,
    color: 'rgba(255,255,255,0.66)',
  },
  soonPill: {
    alignSelf: 'flex-start',
    marginTop: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(127,217,160,0.12)',
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  soonText: {
    ...typography.badge,
    color: '#7FD9A0',
  },
  bottomShell: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent',
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  bottomBar: {
    height: 68,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    ...shadow.medium,
  },
  tabButton: {
    width: 58,
    alignItems: 'center',
    gap: 3,
    paddingVertical: 7,
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.ink3,
  },
  tabLabelActive: {
    color: colors.primaryStrong,
  },
  fab: {
    width: 54,
    height: 54,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -28,
    ...shadow.medium,
  },
  finalizeShell: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bg,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  finalizeButton: {
    height: 58,
    borderRadius: 18,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    ...shadow.medium,
  },
  finalizeButtonDisabled: {
    opacity: 0.55,
  },
  finalizeText: {
    ...typography.labelStrong,
    color: colors.surface,
    fontSize: 16,
  },
  modalScrim: {
    flex: 1,
    backgroundColor: 'rgba(33,36,24,0.32)',
  },
  sheetShell: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: spacing.screen,
    paddingTop: 10,
    paddingBottom: 18,
    gap: 12,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 5,
    backgroundColor: colors.line,
    marginBottom: 4,
  },
  sheetTitle: {
    ...typography.h2,
    color: colors.ink,
  },
  sheetSubtitle: {
    ...typography.body,
    color: colors.ink3,
  },
  fieldLabel: {
    ...typography.labelStrong,
    color: colors.ink2,
  },
  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 52,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
  },
  input: {
    flex: 1,
    ...typography.body,
    color: colors.ink,
    paddingVertical: 0,
  },
  formError: {
    ...typography.label,
    color: colors.coral,
    marginTop: -6,
  },
  optionalRow: {
    flexDirection: 'row',
    gap: 10,
  },
  optionalCapture: {
    flex: 1,
    alignItems: 'center',
    gap: 7,
    borderRadius: 15,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.line,
    padding: 14,
  },
  optionalText: {
    ...typography.label,
    color: colors.ink3,
  },
  sheetPhotoPreview: {
    width: '100%',
    height: 140,
    borderRadius: 16,
    backgroundColor: colors.bg2,
  },
  captureResult: {
    ...typography.label,
    color: colors.ink2,
    backgroundColor: colors.bg2,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  scannerShell: {
    flex: 1,
    backgroundColor: colors.ink,
  },
  scannerHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
    paddingHorizontal: spacing.screen,
    paddingVertical: 16,
  },
  scannerTitle: {
    ...typography.h2,
    color: colors.surface,
  },
  scannerSubtitle: {
    ...typography.bodySmall,
    color: 'rgba(255,255,255,0.68)',
  },
  scannerClose: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scannerCamera: {
    flex: 1,
  },
  scannerHint: {
    ...typography.label,
    color: 'rgba(255,255,255,0.72)',
    textAlign: 'center',
    paddingHorizontal: spacing.screen,
    paddingVertical: 16,
  },
  photoCaptureBar: {
    alignItems: 'center',
    paddingTop: 18,
    backgroundColor: colors.ink,
  },
  photoCaptureButton: {
    width: 74,
    height: 74,
    borderRadius: 74,
    borderWidth: 4,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoCaptureButtonInner: {
    width: 54,
    height: 54,
    borderRadius: 54,
    backgroundColor: colors.surface,
  },
  saveButton: {
    height: 54,
    borderRadius: 16,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  saveButtonDisabled: {
    opacity: 0.72,
  },
  saveButtonText: {
    ...typography.labelStrong,
    color: colors.surface,
  },
});
