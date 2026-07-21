// Composição do app: estado, carregamento dos dados locais e handlers que ligam
// o storage às telas. As telas vivem em src/screens, os componentes em
// src/components e os estilos em src/styles.ts (auditoria 2026-06-09 #12.1).
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import {
  buildInventoryAlerts,
  buildRebuySuggestion,
  estimateShoppingTotal,
  getNextInventoryQuantity,
  isEmptyQuantity,
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
  ScanToListModal,
} from './src/components/modals';
import { productRecordToProduct } from './src/productPresentation';
import { purchaseHistoryRecordsToGroups } from './src/purchaseHistoryPresentation';
import type { PurchaseHistoryGroup, PurchaseHistoryItem } from './src/purchaseHistoryPresentation';
import { EstoqueScreen } from './src/screens/EstoqueScreen';
import { HistoryScreen } from './src/screens/HistoryScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { FutureScreen } from './src/screens/PerfilScreen';
import { ProductsScreen } from './src/screens/ProductsScreen';
import { FinalizeBar, ShoppingListScreen } from './src/screens/ShoppingListScreen';
import { shoppingListRecordToItem } from './src/shoppingListPresentation';
import { consumeProductInventory, markProductInventoryMissing, setProductInventoryQuantity } from './src/storage/inventory';
import { persistPhoto, deletePhoto } from './src/storage/photos';
import { addProductPrice, listRecentPricesByProduct } from './src/storage/priceHistory';
import {
  archiveProduct,
  collectOrphanPhotos,
  createProduct,
  deleteProduct,
  listArchivedProducts,
  listProducts,
  unarchiveProduct,
  updateProduct,
} from './src/storage/products';
import { listPurchaseHistoryRecords, addPurchaseHistoryRecord, removePurchaseHistoryRecord } from './src/storage/purchaseHistory';
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
import { getCasaCode, restoreActiveScope } from './src/storage/syncClient';
import { styles } from './src/styles';
import { colors } from './src/theme';
import { NewProductInput, Product, ShoppingItem, TabKey } from './src/types';

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('home');
  const [showNewProduct, setShowNewProduct] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [activeShoppingListName, setActiveShoppingListName] = useState('Lista de Compras');
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
  const [isScanToListVisible, setIsScanToListVisible] = useState(false);
  // Código lido no scanner da compra sem produto correspondente: pré-preenche o
  // cadastro e faz o produto novo já entrar na lista ao salvar.
  const [scanBarcodeToRegister, setScanBarcodeToRegister] = useState<string | null>(null);
  // Lock por item da lista para serializar toques rápidos no seletor de
  // quantidade (ref, não state: não precisa re-renderizar). (auditoria #39)
  const pendingItems = useRef<Set<number>>(new Set());

  // Carrega os dados locais preservando resultados PARCIAIS: cada leitura é
  // independente (Promise.allSettled), então a falha de uma não zera as outras.
  // Antes tudo caía num único try e o finally marcava todas as telas como
  // prontas, transformando qualquer erro em "listas vazias" — dados existentes
  // pareciam apagados, sem aviso nem retry. Agora só os que falharam ficam sem
  // dado, e o usuário é avisado com opção de tentar de novo. (auditoria #82)
  const loadInitialData = useCallback(async () => {
    // Abre o arquivo SQLite da casa pareada (ou o 'local') ANTES de qualquer
    // leitura, para não ler o scratch quando há uma casa ativa. (auditoria #68)
    await restoreActiveScope();
    const [activeList, records, archivedRecords, listRecords, historyRecords, prices] =
      await Promise.allSettled([
        ensureActiveShoppingList(),
        listProducts(),
        listArchivedProducts(),
        listActiveShoppingItems(),
        listPurchaseHistoryRecords(),
        listRecentPricesByProduct(),
      ]);

    let algumaFalha = false;
    if (activeList.status === 'fulfilled') setActiveShoppingListName(activeList.value.name);
    else algumaFalha = true;
    if (records.status === 'fulfilled') setProducts(records.value.map(productRecordToProduct));
    else algumaFalha = true;
    if (archivedRecords.status === 'fulfilled')
      setArchivedProducts(archivedRecords.value.map(productRecordToProduct));
    else algumaFalha = true;
    if (listRecords.status === 'fulfilled')
      setShoppingItems(listRecords.value.map(shoppingListRecordToItem));
    else algumaFalha = true;
    if (historyRecords.status === 'fulfilled')
      setHistoryGroups(purchaseHistoryRecordsToGroups(historyRecords.value));
    else algumaFalha = true;
    if (prices.status === 'fulfilled') setPricesByProduct(prices.value);
    else algumaFalha = true;

    // Só marca uma tela como pronta quando as leituras que a alimentam tiveram
    // sucesso; uma leitura que falhou mantém a tela em "Carregando" (com o alerta
    // de retry abaixo) em vez de renderizar o estado vazio como se a consulta
    // tivesse dado certo. `prev || ok` impede que um retry parcial esconda dados
    // já exibidos por uma tela que carregou antes. (auditoria #82)
    const productsOk = records.status === 'fulfilled' && archivedRecords.status === 'fulfilled';
    const shoppingOk = activeList.status === 'fulfilled' && listRecords.status === 'fulfilled';
    const historyOk = historyRecords.status === 'fulfilled';
    setIsProductsReady((prev) => prev || productsOk);
    setIsShoppingListReady((prev) => prev || shoppingOk);
    setIsHistoryReady((prev) => prev || historyOk);

    if (algumaFalha) {
      console.error('Failed to load some app data');
      Alert.alert(
        'Erro ao carregar',
        'Alguns dados locais não puderam ser lidos agora. Toque em tentar novamente.',
        [
          { text: 'Fechar', style: 'cancel' },
          { text: 'Tentar novamente', onPress: () => void loadInitialData() },
        ],
      );
    }
  }, []);

  useEffect(() => {
    void loadInitialData();
  }, [loadInitialData]);

  // GC de fotos órfãs uma vez por sessão, em segundo plano: recolhe arquivos
  // sem produto correspondente (órfãos históricos e restos de falha). Idempotente
  // e best-effort — nunca bloqueia nem quebra a UI. Restaura o escopo antes, para
  // rodar contra o arquivo da casa ativa, não o 'local'. (auditoria #94, #68)
  useEffect(() => {
    void (async () => {
      await restoreActiveScope();
      await collectOrphanPhotos();
    })().catch((error) => {
      console.error('Failed to collect orphan photos', error);
    });
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
    // Serializa por item: ignora novos toques enquanto uma escrita do mesmo item
    // está pendente. Sem isto, dois toques rápidos calculam o próximo valor a
    // partir do mesmo item.quantity renderizado e um incremento se perde.
    // (auditoria #39)
    if (pendingItems.current.has(item.id)) return;
    pendingItems.current.add(item.id);
    try {
      // Mesma regra do web (lista-client): piso via isEmptyQuantity, que mantém o
      // valor atual em vez de subir uma quantidade fracionária ("0,8 kg" - 1 não
      // vira "1 kg"). Centralizado no core em vez do helper local. (auditoria #81)
      const next = getNextInventoryQuantity(item.quantity, direction);
      const nextQuantity = isEmptyQuantity(next) ? item.quantity : next;
      await updateShoppingListItemQuantity(item.id, nextQuantity);
      await refreshShoppingItems();
    } finally {
      pendingItems.current.delete(item.id);
    }
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
    setScanBarcodeToRegister(null);
    setShowNewProduct(true);
  }

  function openRegisterFromScan(barcode: string) {
    setIsScanToListVisible(false);
    setProductFormError(null);
    setProductActionError(null);
    setEditingProduct(null);
    setScanBarcodeToRegister(barcode);
    setShowNewProduct(true);
  }

  function openEditProduct(product: Product) {
    setProductFormError(null);
    setProductActionError(null);
    setEditingProduct(product);
    setShowNewProduct(true);
  }

  async function handleSaveProduct(input: NewProductInput) {
    // Foto persistida nesta tentativa, para rollback do arquivo se a escrita falhar.
    let persistedPhotoUri: string | null = null;
    try {
      setProductFormError(null);
      setProductActionError(null);

      // Persiste a foto no diretório do app antes de salvar (a câmera grava no
      // cache, que o sistema pode limpar).
      persistedPhotoUri = persistPhoto(input.photoUri);
      const persisted = { ...input, photoUri: persistedPhotoUri };

      if (editingProduct?.id) {
        await updateProduct(editingProduct.id, persisted);
        await Promise.all([refreshProducts(), refreshShoppingItems(), refreshHistory()]);
      } else {
        const created = await createProduct(persisted);
        await refreshProducts();
        // Cadastro vindo do scanner da compra: o produto novo já entra na lista.
        if (scanBarcodeToRegister) {
          await addProductToActiveShoppingList(created.id);
          await refreshShoppingItems();
        }
      }

      setShowNewProduct(false);
      setEditingProduct(null);
      setActiveTab(scanBarcodeToRegister ? 'list' : 'products');
      setScanBarcodeToRegister(null);
    } catch (error) {
      // Rollback do arquivo: se a escrita falhou depois de copiar uma foto NOVA
      // para o diretório do app, apaga a cópia órfã. Só quando é cópia nova
      // (difere da URI de entrada); uma foto já persistida e reaproveitada na
      // edição segue referenciada pelo produto inalterado. (auditoria #94)
      if (persistedPhotoUri && persistedPhotoUri !== input.photoUri) {
        deletePhoto(persistedPhotoUri);
      }
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

  // Scanner na compra: produto identificado pelo código de barras entra na
  // lista ativa já com a quantidade escolhida.
  async function handleScanAddToList(productId: number, quantity: string) {
    setIsScanToListVisible(false);
    await addProductToActiveShoppingList(productId, quantity);
    await refreshShoppingItems();
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

  async function handleRemovePurchaseLine(lineId: number) {
    try {
      await removePurchaseHistoryRecord(lineId);
      // refreshProducts também: a edição recalcula purchase_count.
      await Promise.all([refreshHistory(), refreshProducts()]);
      // Atualiza o modal aberto com os dados frescos.
      setSelectedPurchase((prev) => {
        if (!prev) return null;
        const updated = prev.lines.filter((l) => l.id !== lineId);
        if (updated.length === 0) return null;
        const count = updated.length;
        const itemLabel = count === 1 ? 'item' : 'itens';
        return { ...prev, lines: updated, count: `${count} ${itemLabel}` };
      });
    } catch (error) {
      console.error('Failed to remove purchase line', error);
    }
  }

  async function handleAddPurchaseLine(purchase: PurchaseHistoryItem, productId: number, quantity: string) {
    try {
      await addPurchaseHistoryRecord(productId, quantity, purchase.purchasedAt, purchase.sourceListName);
      // refreshProducts também: a edição recalcula purchase_count.
      await Promise.all([refreshHistory(), refreshProducts()]);
      // Recarrega o histórico inteiro e re-seleciona a compra atualizada.
      const freshRecords = await listPurchaseHistoryRecords();
      const freshGroups = purchaseHistoryRecordsToGroups(freshRecords);
      const freshPurchase = freshGroups.flatMap((g) => g.items).find((i) => i.id === purchase.id);
      if (freshPurchase) setSelectedPurchase(freshPurchase);
    } catch (error) {
      console.error('Failed to add purchase line', error);
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
              onOpenEstoque={() => setActiveTab('estoque')}
              onOpenPerfil={() => setActiveTab('future')}
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
              onScan={() => setIsScanToListVisible(true)}
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
              onRegisterPrice={openPriceModal}
              onUnarchiveProduct={handleUnarchiveProduct}
            />
          ) : null}
          {activeTab === 'estoque' ? (
            <EstoqueScreen
              products={products}
              isReady={isProductsReady}
              errorMessage={productActionError}
              onAddProductToList={handleAddProductToList}
              onChangeInventory={handleChangeProductInventory}
              onMarkInventoryMissing={handleMarkProductMissing}
              onConsumeProduct={handleConsumeProduct}
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
          initialBarcode={scanBarcodeToRegister}
          errorMessage={productFormError}
          onClose={() => {
            setShowNewProduct(false);
            setEditingProduct(null);
            setScanBarcodeToRegister(null);
          }}
          onSave={handleSaveProduct}
        />

        <PriceEntryModal
          product={pricingProduct}
          errorMessage={priceError}
          onClose={() => setPricingProduct(null)}
          onSave={handleSavePrice}
        />

        <PurchaseDetailModal
          purchase={selectedPurchase}
          priceSummaries={priceSummaries}
          products={products}
          onClose={() => setSelectedPurchase(null)}
          onRemoveLine={handleRemovePurchaseLine}
          onAddProduct={handleAddPurchaseLine}
        />

        <ScanToListModal
          visible={isScanToListVisible}
          onClose={() => setIsScanToListVisible(false)}
          onAdd={(productId, quantity) => {
            void handleScanAddToList(productId, quantity);
          }}
          onRegister={openRegisterFromScan}
        />

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

