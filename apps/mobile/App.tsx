// Composição do app: estado, carregamento dos dados locais e handlers que ligam
// o storage às telas. As telas vivem em src/screens, os componentes em
// src/components e os estilos em src/styles.ts (auditoria 2026-06-09 #12.1).
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { Alert, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import {
  buildInventoryAlerts,
  buildRebuySuggestion,
  estimateShoppingTotal,
  getNextInventoryQuantity,
  summarizePrices,
  type PricePoint,
  type PriceSummary,
} from '@repona/core';

import { BottomNavigation } from './src/components/navigation';
import {
  NewProductSheet,
  PriceEntryModal,
  PurchaseDetailModal,
  QuantityEntryModal,
} from './src/components/modals';
import { productRecordToProduct } from './src/productPresentation';
import { purchaseHistoryRecordsToGroups } from './src/purchaseHistoryPresentation';
import type { PurchaseHistoryGroup, PurchaseHistoryItem } from './src/purchaseHistoryPresentation';
import { HistoryScreen } from './src/screens/HistoryScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { FutureScreen } from './src/screens/PerfilScreen';
import { ProductsScreen } from './src/screens/ProductsScreen';
import { FinalizeBar, ShoppingListScreen } from './src/screens/ShoppingListScreen';
import { shoppingListRecordToItem } from './src/shoppingListPresentation';
import { consumeProductInventory, markProductInventoryMissing, setProductInventoryQuantity } from './src/storage/inventory';
import { persistPhoto } from './src/storage/photos';
import { addProductPrice, listRecentPricesByProduct } from './src/storage/priceHistory';
import {
  archiveProduct,
  createProduct,
  deleteProduct,
  listArchivedProducts,
  listProducts,
  unarchiveProduct,
  updateProduct,
} from './src/storage/products';
import { listPurchaseHistoryRecords } from './src/storage/purchaseHistory';
import {
  addProductToActiveShoppingList,
  createNewActiveShoppingList,
  ensureActiveShoppingList,
  finalizeActiveShoppingList,
  listActiveShoppingItems,
  removeShoppingListItem,
  toggleShoppingListItem,
  updateShoppingListItemQuantity,
} from './src/storage/shoppingLists';
import { getCasaCode } from './src/storage/syncClient';
import { styles } from './src/styles';
import { colors } from './src/theme';
import { NewProductInput, Product, ShoppingItem, TabKey } from './src/types';

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
      // Casa pareada: a exclusão física não viaja no sync (não há tombstone de
      // produto) e o produto "voltaria sozinho" no próximo merge — então
      // arquivamos, que propaga via flag. Sem pareamento, o dado é só local e a
      // exclusão de verdade é permitida. (auditoria 2026-06-09 #3)
      if (await getCasaCode()) {
        await archiveProduct(product.id);
        await Promise.all([refreshProducts(), refreshShoppingItems()]);
        return;
      }
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
      `Remover ${product.name} do catálogo? Com a casa sincronizada na nuvem ou histórico de compras, o produto é arquivado (o histórico é preservado).`,
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
          {activeTab === 'history' ? <HistoryScreen historyGroups={historyGroups} priceSummaries={priceSummaries} isReady={isHistoryReady} onOpenPurchase={setSelectedPurchase} /> : null}
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

function getProductErrorMessage(error: unknown) {
  if (error instanceof Error) {
    if (error.message === 'PRODUCT_NAME_REQUIRED') {
      return 'Informe o nome do produto.';
    }

    if (error.message === 'PRODUCT_ALREADY_EXISTS') {
      return 'Esse produto já está cadastrado.';
    }

    if (error.message === 'PRODUCT_BARCODE_EXISTS') {
      return 'Já existe um produto com esse código de barras.';
    }

    if (error.message === 'PRODUCT_FIELD_TOO_LONG') {
      return 'Algum campo ultrapassou o limite de caracteres.';
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
