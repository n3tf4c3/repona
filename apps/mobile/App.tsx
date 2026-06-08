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
import { archiveProduct, createProduct, deleteProduct, listArchivedProducts, listProducts, unarchiveProduct, updateProduct } from './src/storage/products';
import { persistPhoto } from './src/storage/photos';
import { addProductPrice, listRecentPricesByProduct } from './src/storage/priceHistory';
import { formatCentsBRL, parsePriceToCents } from './src/priceFormat';
import {
  criarConta,
  getCasaCode,
  getLastSyncAt,
  pairAndSync,
  syncNow,
  unpairCasa,
  type SyncResult,
} from './src/storage/syncClient';
import { IconName, NewProductInput, Product, ShoppingItem, TabKey } from './src/types';
import { colors, radius, shadow, spacing, typography } from './src/theme';
import {
  buildInventoryAlerts,
  buildRebuySuggestion,
  estimateShoppingTotal,
  getNextInventoryQuantity,
  summarizePrices,
  type InventoryAlert as CoreInventoryAlert,
  type RebuySuggestion as CoreRebuySuggestion,
  type PricePoint,
  type PriceSummary,
  type ShoppingTotalEstimate,
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
  const [archivedProducts, setArchivedProducts] = useState<Product[]>([]);
  const [isProductsReady, setIsProductsReady] = useState(false);
  const [historyGroups, setHistoryGroups] = useState<PurchaseHistoryGroup[]>([]);
  const [isHistoryReady, setIsHistoryReady] = useState(false);
  const [isFinalizingPurchase, setIsFinalizingPurchase] = useState(false);
  const [productFormError, setProductFormError] = useState<string | null>(null);
  const [productActionError, setProductActionError] = useState<string | null>(null);
  const [pricesByProduct, setPricesByProduct] = useState<Map<number, PricePoint[]>>(new Map());
  const [pricingProduct, setPricingProduct] = useState<Product | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [selectedPurchase, setSelectedPurchase] = useState<PurchaseHistoryItem | null>(null);
  const [editingQuantityItem, setEditingQuantityItem] = useState<ShoppingItem | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadInitialProducts() {
      try {
        await seedActiveShoppingList();
        const activeList = await ensureActiveShoppingList();
        const records = await listProducts();
        const archivedRecords = await listArchivedProducts();
        const listRecords = await listActiveShoppingItems();
        const historyRecords = await listPurchaseHistoryRecords();
        const prices = await listRecentPricesByProduct();

        if (isMounted) {
          setActiveShoppingListName(activeList.name);
          setProducts(records.map(productRecordToProduct));
          setArchivedProducts(archivedRecords.map(productRecordToProduct));
          setShoppingItems(listRecords.map(shoppingListRecordToItem));
          setHistoryGroups(purchaseHistoryRecordsToGroups(historyRecords));
          setPricesByProduct(prices);
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
    const [records, archivedRecords] = await Promise.all([listProducts(), listArchivedProducts()]);
    setProducts(records.map(productRecordToProduct));
    setArchivedProducts(archivedRecords.map(productRecordToProduct));
  }

  async function refreshHistory() {
    const historyRecords = await listPurchaseHistoryRecords();
    setHistoryGroups(purchaseHistoryRecordsToGroups(historyRecords));
  }

  async function refreshPrices() {
    setPricesByProduct(await listRecentPricesByProduct());
  }

  function openPriceModal(product: Product) {
    setPriceError(null);
    setPricingProduct(product);
  }

  async function handleSavePrice(priceCents: number) {
    if (!pricingProduct?.id) {
      return;
    }
    try {
      setPriceError(null);
      await addProductPrice(pricingProduct.id, priceCents);
      await refreshPrices();
      setPricingProduct(null);
    } catch (error) {
      console.error('Failed to save product price', error);
      setPriceError('Não foi possível salvar o preço agora.');
    }
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

  async function saveItemQuantity(itemId: number, quantity: string) {
    await updateShoppingListItemQuantity(itemId, quantity);
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

      // Persiste a foto no diretório do app antes de salvar (a câmera grava no
      // cache, que o sistema pode limpar).
      const persisted = { ...input, photoUri: persistPhoto(input.photoUri) };

      if (editingProduct?.id) {
        await updateProduct(editingProduct.id, persisted);
        await Promise.all([refreshProducts(), refreshShoppingItems(), refreshHistory()]);
      } else {
        await createProduct(persisted);
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
      // Produto com histórico não pode ser excluído (perderia o histórico):
      // nesse caso arquivamos (some do catálogo, histórico/preços preservados).
      if (error instanceof Error && error.message === 'PRODUCT_HAS_HISTORY' && product.id) {
        await archiveProduct(product.id);
        await Promise.all([refreshProducts(), refreshShoppingItems()]);
      } else {
        setProductActionError(getProductErrorMessage(error));
      }
    }
  }

  async function handleUnarchiveProduct(product: Product) {
    if (!product.id) {
      return;
    }
    await unarchiveProduct(product.id);
    await refreshProducts();
  }

  function confirmRemoveProduct(product: Product) {
    Alert.alert(
      'Remover produto',
      `Remover ${product.name} do catálogo? Se tiver histórico de compras, será arquivado (o histórico é preservado).`,
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
  const priceSummaries = useMemo(() => {
    const map = new Map<number, PriceSummary>();
    for (const [productId, points] of pricesByProduct) {
      const summary = summarizePrices(points);
      if (summary) map.set(productId, summary);
    }
    return map;
  }, [pricesByProduct]);
  const shoppingTotal = useMemo(
    () =>
      estimateShoppingTotal(
        shoppingItems
          .filter((item) => item.checked)
          .map((item) => ({
            priceCents: item.productId !== undefined ? priceSummaries.get(item.productId)?.lastCents ?? null : null,
            quantity: item.quantity,
          })),
      ),
    [shoppingItems, priceSummaries],
  );

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
              priceSummaries={priceSummaries}
              onBack={() => setActiveTab('home')}
              onToggleItem={toggleItem}
              onChangeQuantity={changeItemQuantity}
              onEditQuantity={setEditingQuantityItem}
              onRemoveItem={removeItem}
              onNewList={confirmCreateNewShoppingList}
            />
          ) : null}
          {activeTab === 'products' ? (
            <ProductsScreen
              products={products}
              archivedProducts={archivedProducts}
              isProductsReady={isProductsReady}
              errorMessage={productActionError}
              priceSummaries={priceSummaries}
              onAddProductToList={handleAddProductToList}
              onEditProduct={openEditProduct}
              onRemoveProduct={confirmRemoveProduct}
              onChangeInventory={handleChangeProductInventory}
              onMarkInventoryMissing={handleMarkProductMissing}
              onConsumeProduct={handleConsumeProduct}
              onRegisterPrice={openPriceModal}
              onUnarchiveProduct={handleUnarchiveProduct}
            />
          ) : null}
          {activeTab === 'history' ? <HistoryScreen historyGroups={historyGroups} isReady={isHistoryReady} onOpenPurchase={setSelectedPurchase} /> : null}
          {activeTab === 'future' ? (
            <FutureScreen
              onSynced={() => {
                void Promise.all([refreshProducts(), refreshShoppingItems(), refreshHistory(), refreshPrices()]);
              }}
            />
          ) : null}
        </SafeAreaView>

        {activeTab === 'list' ? (
          <FinalizeBar items={shoppingItems} estimate={shoppingTotal} isFinalizing={isFinalizingPurchase} onFinalize={handleFinalizePurchase} />
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

        <PriceEntryModal
          product={pricingProduct}
          errorMessage={priceError}
          onClose={() => setPricingProduct(null)}
          onSave={handleSavePrice}
        />

        <PurchaseDetailModal purchase={selectedPurchase} priceSummaries={priceSummaries} onClose={() => setSelectedPurchase(null)} />

        <QuantityEntryModal
          item={editingQuantityItem}
          onClose={() => setEditingQuantityItem(null)}
          onSave={(itemId, quantity) => {
            setEditingQuantityItem(null);
            void saveItemQuantity(itemId, quantity);
          }}
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

function ShoppingListScreen({
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

function ProductsScreen({
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
      <ChipRow chips={['Todos', 'Mercearia', 'Hortifrúti', 'Laticínios', 'Limpeza', 'Bebidas']} selected={selectedCategory} onSelect={setSelectedCategory} />
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

function ArchivedProductRow({ product, onUnarchive }: { product: Product; onUnarchive: (product: Product) => void }) {
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

function HistoryScreen({
  historyGroups,
  isReady,
  onOpenPurchase,
}: {
  historyGroups: PurchaseHistoryGroup[];
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
            <HistoryCard key={item.id} item={item} onOpen={onOpenPurchase} />
          ))}
        </View>
      ))}
    </ScreenScroll>
  );
}

function FutureScreen({ onSynced }: { onSynced: () => void }) {
  return (
    <ScreenScroll>
      <Header eyebrow="No horizonte" title="Casa Repona" />
      <View style={styles.futureHero}>
        <IconBubble icon="home-variant-outline" background="rgba(127,217,160,0.18)" tint="#7FD9A0" size={52} />
        <Text style={styles.futureHeroTitle}>Feito para famílias brasileiras</Text>
        <Text style={styles.futureHeroText}>
          O MVP funciona offline e já prepara espaço para estoque doméstico, scanner e compartilhamento familiar.
        </Text>
      </View>
      <CasaSyncCard onSynced={onSynced} />
    </ScreenScroll>
  );
}

const SYNC_ERROR_MESSAGES: Record<Exclude<SyncResult, { ok: true }>['error'], string> = {
  NOT_PAIRED: 'Crie uma conta ou conecte com um token primeiro.',
  INVALID_CODE: 'Token inválido. São 8 caracteres (letras e números).',
  INVALID_NAME: 'Informe um nome para a conta.',
  NETWORK: 'Sem conexão com o servidor. Confira a rede e a URL da API.',
  CASA_NOT_FOUND: 'Nenhuma conta encontrada com esse token.',
  SERVER: 'O servidor recusou a operação. Tente de novo.',
};

function formatSyncMoment(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'agora';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)} às ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function CasaSyncCard({ onSynced }: { onSynced: () => void }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [pairedCode, setPairedCode] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    void (async () => {
      setPairedCode(await getCasaCode());
      setLastSyncAt(await getLastSyncAt());
    })();
  }, []);

  function handleResult(result: SyncResult) {
    if (result.ok) {
      setLastSyncAt(result.lastSyncAt);
      setMessage({ kind: 'ok', text: 'Tudo sincronizado com a casa.' });
      onSynced();
    } else {
      setMessage({ kind: 'error', text: SYNC_ERROR_MESSAGES[result.error] });
    }
  }

  async function handleCreate() {
    setBusy(true);
    setMessage(null);
    const result = await criarConta(name);
    if (result.ok) {
      setPairedCode(await getCasaCode());
      setName('');
    }
    setBusy(false);
    handleResult(result);
  }

  async function handlePair() {
    setBusy(true);
    setMessage(null);
    const result = await pairAndSync(code);
    setBusy(false);
    if (result.ok) {
      setPairedCode(code.trim().toUpperCase());
      setCode('');
    }
    handleResult(result);
  }

  async function handleSync() {
    setBusy(true);
    setMessage(null);
    const result = await syncNow();
    setBusy(false);
    handleResult(result);
  }

  function handleUnpair() {
    Alert.alert('Desconectar da casa', 'Os dados locais continuam no aparelho. Deseja desconectar?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Desconectar',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await unpairCasa();
            setPairedCode(null);
            setLastSyncAt(null);
            setMessage(null);
          })();
        },
      },
    ]);
  }

  return (
    <View style={styles.syncCard}>
      <View style={styles.syncHeader}>
        <IconBubble icon="cloud-sync-outline" background={colors.indigoSoft} tint={colors.indigo} size={44} />
        <View style={styles.syncHeaderText}>
          <Text style={styles.syncTitle}>Conta e backup</Text>
          <Text style={styles.subtleText}>
            Crie sua conta para guardar produtos, estoque e histórico na nuvem e acessar pelo web.
          </Text>
        </View>
      </View>

      {pairedCode ? (
        <>
          <View style={styles.syncPairedRow}>
            <Text style={styles.syncPairedLabel}>Token de acesso</Text>
            <Text style={styles.syncPairedCode}>{pairedCode}</Text>
          </View>
          <Text style={styles.subtleText}>Use esse token para entrar no app web.</Text>
          <Text style={styles.subtleText}>
            {lastSyncAt ? `Última sincronização: ${formatSyncMoment(lastSyncAt)}.` : 'Ainda não sincronizado.'}
          </Text>
          <Pressable
            style={[styles.saveButton, busy ? styles.saveButtonDisabled : null]}
            disabled={busy}
            onPress={handleSync}
          >
            <MaterialCommunityIcons name="sync" size={20} color={colors.surface} />
            <Text style={styles.saveButtonText}>{busy ? 'Sincronizando...' : 'Sincronizar agora'}</Text>
          </Pressable>
          <Pressable style={styles.syncUnpairButton} disabled={busy} onPress={handleUnpair}>
            <Text style={styles.syncUnpairText}>Desconectar</Text>
          </Pressable>
        </>
      ) : (
        <>
          <View style={styles.inputBox}>
            <MaterialCommunityIcons name="account-outline" size={20} color={colors.primaryStrong} />
            <TextInput
              value={name}
              onChangeText={setName}
              style={styles.input}
              placeholder="Nome da conta (ex.: Casa do Paulo)"
              placeholderTextColor={colors.ink3}
              maxLength={80}
            />
          </View>
          <Pressable
            style={[styles.saveButton, busy ? styles.saveButtonDisabled : null]}
            disabled={busy}
            onPress={handleCreate}
          >
            <MaterialCommunityIcons name="account-plus-outline" size={20} color={colors.surface} />
            <Text style={styles.saveButtonText}>{busy ? 'Criando...' : 'Criar conta'}</Text>
          </Pressable>

          <View style={styles.syncDivider}>
            <View style={styles.syncDividerLine} />
            <Text style={styles.syncDividerText}>ou já tenho um token</Text>
            <View style={styles.syncDividerLine} />
          </View>

          <View style={styles.inputBox}>
            <MaterialCommunityIcons name="key-outline" size={20} color={colors.primaryStrong} />
            <TextInput
              value={code}
              onChangeText={(text) => setCode(text.toUpperCase())}
              style={styles.input}
              placeholder="Token (8 caracteres)"
              placeholderTextColor={colors.ink3}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={8}
            />
          </View>
          <Pressable
            style={styles.syncUnpairButton}
            disabled={busy}
            onPress={handlePair}
          >
            <Text style={styles.syncConnectText}>{busy ? 'Conectando...' : 'Conectar com token'}</Text>
          </Pressable>
        </>
      )}

      {message ? (
        <Text style={message.kind === 'ok' ? styles.syncMessageOk : styles.formError}>{message.text}</Text>
      ) : null}
    </View>
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

function SectionTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.sectionTitle}>
      <Text style={styles.sectionTitleText}>{title}</Text>
      {action ? (
        onAction ? (
          <Pressable onPress={onAction}>
            <Text style={styles.sectionAction}>{action}</Text>
          </Pressable>
        ) : (
          <Text style={styles.sectionAction}>{action}</Text>
        )
      ) : null}
    </View>
  );
}

function ProductRow({
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
    <View style={styles.productRow}>
      {product.photoUri ? (
        <Image source={{ uri: product.photoUri }} style={styles.productPhoto} />
      ) : (
        <IconBubble icon={product.icon} background={product.background} tint={product.tint} size={44} />
      )}
      <View style={styles.productText}>
        <View style={styles.productNameRow}>
          <Text style={styles.productName} numberOfLines={1}>{product.name}</Text>
          {product.occasional ? <Text style={styles.eventualBadge}>Eventual</Text> : null}
        </View>
        <Text style={styles.productMeta} numberOfLines={1}>{product.meta}</Text>
        {priceSummary ? <PriceSummaryLine summary={priceSummary} /> : null}
        {onChangeInventory && onMarkInventoryMissing && onConsume ? (
          <InventoryControls product={product} onChange={onChangeInventory} onMarkMissing={onMarkInventoryMissing} onConsume={onConsume} />
        ) : null}
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
  onChangeInventory: (product: Product, direction: 1 | -1) => void;
  onMarkInventoryMissing: (product: Product) => void;
  onConsume: (product: Product) => void;
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

function MissingBadge() {
  return (
    <View style={styles.missingBadge}>
      <MaterialCommunityIcons name="alert-circle-outline" size={13} color={colors.coral} />
      <Text style={styles.missingText}>Em falta em casa</Text>
    </View>
  );
}

function PriceSummaryLine({ summary }: { summary: PriceSummary }) {
  const trendIcon = summary.trend === 'up' ? 'arrow-up' : summary.trend === 'down' ? 'arrow-down' : 'minus';
  const trendColor =
    summary.trend === 'up' ? colors.coral : summary.trend === 'down' ? colors.primaryStrong : colors.ink3;
  return (
    <View style={styles.priceLine}>
      <Text style={styles.priceLast}>{formatCentsBRL(summary.lastCents)}</Text>
      <MaterialCommunityIcons name={trendIcon} size={13} color={trendColor} />
      {summary.count > 1 ? (
        <Text style={styles.priceRange}>
          mín {formatCentsBRL(summary.minCents)} · máx {formatCentsBRL(summary.maxCents)}
        </Text>
      ) : null}
    </View>
  );
}

function PriceEntryModal({
  product,
  errorMessage,
  onClose,
  onSave,
}: {
  product: Product | null;
  errorMessage: string | null;
  onClose: () => void;
  onSave: (priceCents: number) => void;
}) {
  const [value, setValue] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (product) {
      setValue('');
      setLocalError(null);
    }
  }, [product]);

  function handleSave() {
    const cents = parsePriceToCents(value);
    if (cents === null) {
      setLocalError('Informe um preço válido (ex.: 8,90).');
      return;
    }
    onSave(cents);
  }

  return (
    <Modal visible={product !== null} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalScrim} onPress={onClose} />
      <SafeAreaView edges={['bottom']} style={styles.sheetShell}>
        <View style={styles.sheetHandle} />
        <Text style={styles.sheetTitle}>Registrar preço</Text>
        <Text style={styles.sheetSubtitle}>{product?.name ?? ''} · guardamos os últimos 10 com a data.</Text>
        <Text style={styles.fieldLabel}>Preço (R$)</Text>
        <View style={styles.inputBox}>
          <MaterialCommunityIcons name="cash" size={20} color={colors.primaryStrong} />
          <TextInput
            value={value}
            onChangeText={setValue}
            style={styles.input}
            placeholder="Ex.: 8,90"
            placeholderTextColor={colors.ink3}
            keyboardType="decimal-pad"
            autoFocus
          />
        </View>
        {localError || errorMessage ? <Text style={styles.formError}>{localError ?? errorMessage}</Text> : null}
        <Pressable style={styles.saveButton} onPress={handleSave}>
          <MaterialCommunityIcons name="check" size={20} color={colors.surface} />
          <Text style={styles.saveButtonText}>Salvar preço</Text>
        </Pressable>
      </SafeAreaView>
    </Modal>
  );
}

function HistoryCard({ item, onOpen }: { item: PurchaseHistoryItem; onOpen: (item: PurchaseHistoryItem) => void }) {
  return (
    <Pressable style={styles.historyCard} onPress={() => onOpen(item)}>
      <View style={styles.historyCardTop}>
        <Text style={styles.historyTitle}>{item.title}</Text>
        <View style={styles.historyTopRight}>
          <Text style={styles.historyTotal}>{item.total}</Text>
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

function PurchaseDetailModal({
  purchase,
  priceSummaries,
  onClose,
}: {
  purchase: PurchaseHistoryItem | null;
  priceSummaries: Map<number, PriceSummary>;
  onClose: () => void;
}) {
  const estimate = useMemo(
    () =>
      estimateShoppingTotal(
        (purchase?.lines ?? []).map((line) => ({
          priceCents: priceSummaries.get(line.productId)?.lastCents ?? null,
          quantity: line.quantity,
        })),
      ),
    [purchase, priceSummaries],
  );

  return (
    <Modal visible={purchase !== null} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalScrim} onPress={onClose} />
      <SafeAreaView edges={['bottom']} style={styles.sheetShell}>
        <View style={styles.sheetHandle} />
        <Text style={styles.sheetTitle}>{purchase?.title ?? ''}</Text>
        <Text style={styles.sheetSubtitle}>{purchase ? `${purchase.date} · ${purchase.count}` : ''}</Text>
        <ScrollView style={styles.purchaseLinesScroll} contentContainerStyle={styles.purchaseLines}>
          {purchase?.lines.map((line, index) => (
            <View key={`${line.name}-${index}`} style={styles.purchaseLine}>
              <Text style={styles.purchaseLineName} numberOfLines={1}>{line.name}</Text>
              <Text style={styles.purchaseLineQty}>{line.quantity}</Text>
            </View>
          ))}
        </ScrollView>
        {estimate.pricedCount > 0 ? (
          <View style={styles.estimateRow}>
            <View>
              <Text style={styles.estimateLabel}>Total estimado</Text>
              {estimate.missingCount > 0 ? (
                <Text style={styles.estimateHint}>Parcial · {estimate.missingCount} sem preço</Text>
              ) : null}
            </View>
            <Text style={styles.estimateValue}>{formatCentsBRL(estimate.totalCents)}</Text>
          </View>
        ) : null}
      </SafeAreaView>
    </Modal>
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
  const [occasional, setOccasional] = useState(false);
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
      setOccasional(product?.occasional ?? false);
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
    await onSave({ name, category, barcode, photoUri, alertThreshold: alertThreshold.trim() || null, occasional });
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
          <Pressable style={styles.occasionalRow} onPress={() => setOccasional((value) => !value)}>
            <MaterialCommunityIcons
              name={occasional ? 'checkbox-marked' : 'checkbox-blank-outline'}
              size={22}
              color={occasional ? colors.primaryStrong : colors.ink3}
            />
            <View style={styles.occasionalTextBlock}>
              <Text style={styles.occasionalTitle}>Compra eventual</Text>
              <Text style={styles.occasionalHint}>Itens de ocasião (ex.: churrasco) não geram alerta de reposição.</Text>
            </View>
          </Pressable>
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

function QuantityEntryModal({
  item,
  onClose,
  onSave,
}: {
  item: ShoppingItem | null;
  onClose: () => void;
  onSave: (itemId: number, quantity: string) => void;
}) {
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState('un');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (item) {
      const parsed = item.quantity.match(/^(\d+(?:[.,]\d+)?)\s*(.*)$/);
      setValue(parsed ? parsed[1].replace('.', ',') : '');
      setUnit(parsed?.[2].trim() || 'un');
      setError(null);
    }
  }, [item]);

  function handleSave() {
    const num = Number(value.replace(',', '.'));
    if (!Number.isFinite(num) || num <= 0) {
      setError('Informe uma quantidade válida (ex.: 0,8).');
      return;
    }
    const formatted = `${num}`.replace('.', ',');
    if (item) onSave(item.id, `${formatted} ${unit}`);
  }

  return (
    <Modal visible={item !== null} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalScrim} onPress={onClose} />
      <SafeAreaView edges={['bottom']} style={styles.sheetShell}>
        <View style={styles.sheetHandle} />
        <Text style={styles.sheetTitle}>Quantidade</Text>
        <Text style={styles.sheetSubtitle}>{item?.name ?? ''}</Text>
        <View style={styles.inputBox}>
          <MaterialCommunityIcons name="scale-balance" size={20} color={colors.primaryStrong} />
          <TextInput
            value={value}
            onChangeText={setValue}
            style={styles.input}
            placeholder="Ex.: 0,8"
            placeholderTextColor={colors.ink3}
            keyboardType="decimal-pad"
            autoFocus
          />
        </View>
        <ChipRow chips={['un', 'kg', 'g']} selected={unit} onSelect={setUnit} />
        {error ? <Text style={styles.formError}>{error}</Text> : null}
        <Pressable style={styles.saveButton} onPress={handleSave}>
          <MaterialCommunityIcons name="check" size={20} color={colors.surface} />
          <Text style={styles.saveButtonText}>Salvar</Text>
        </Pressable>
      </SafeAreaView>
    </Modal>
  );
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
  archivedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line2,
    backgroundColor: colors.surface,
    marginBottom: 4,
  },
  archivedToggleActive: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },
  archivedToggleText: {
    ...typography.labelStrong,
    color: colors.ink2,
  },
  archivedToggleTextActive: {
    color: colors.surface,
  },
  unarchiveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line2,
  },
  unarchiveText: {
    ...typography.labelStrong,
    color: colors.primaryStrong,
  },
  occasionalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 4,
  },
  occasionalTextBlock: {
    flex: 1,
  },
  occasionalTitle: {
    ...typography.labelStrong,
    color: colors.ink,
  },
  occasionalHint: {
    ...typography.label,
    color: colors.ink3,
  },
  productNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  eventualBadge: {
    ...typography.label,
    color: colors.ink2,
    backgroundColor: colors.bg2,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
    overflow: 'hidden',
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
    alignItems: 'center',
    marginBottom: 10,
  },
  historyTopRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  historyTitle: {
    ...typography.h3,
    color: colors.ink,
  },
  historyTotal: {
    ...typography.h3,
    color: colors.primaryStrong,
  },
  purchaseLinesScroll: {
    maxHeight: 360,
  },
  purchaseLines: {
    gap: 2,
  },
  purchaseLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.line2,
  },
  purchaseLineName: {
    ...typography.body,
    color: colors.ink,
    flex: 1,
  },
  purchaseLineQty: {
    ...typography.labelStrong,
    color: colors.ink2,
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
  estimateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingBottom: 8,
  },
  estimateLabel: {
    ...typography.labelStrong,
    color: colors.ink2,
  },
  estimateHint: {
    ...typography.label,
    color: colors.ink3,
  },
  estimateValue: {
    ...typography.h2,
    color: colors.primaryStrong,
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
  syncCard: {
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.indigoSoft,
    padding: 16,
    ...shadow.small,
  },
  syncHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
  },
  syncHeaderText: {
    flex: 1,
    gap: 3,
  },
  syncTitle: {
    ...typography.h3,
    color: colors.ink,
  },
  syncPairedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    backgroundColor: colors.indigoSoft,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  syncPairedLabel: {
    ...typography.labelStrong,
    color: colors.ink2,
  },
  syncPairedCode: {
    ...typography.labelStrong,
    color: colors.indigo,
    letterSpacing: 2,
  },
  syncUnpairButton: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  syncUnpairText: {
    ...typography.label,
    color: colors.coral,
  },
  syncMessageOk: {
    ...typography.label,
    color: colors.primaryStrong,
  },
  syncDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginVertical: 2,
  },
  syncDividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.line,
  },
  syncDividerText: {
    ...typography.label,
    color: colors.ink3,
  },
  syncConnectText: {
    ...typography.labelStrong,
    color: colors.indigo,
  },
  priceLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 4,
  },
  priceLast: {
    ...typography.labelStrong,
    color: colors.ink,
  },
  priceRange: {
    ...typography.label,
    color: colors.ink3,
  },
});
