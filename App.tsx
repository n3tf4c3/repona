import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import {
  futureFeatures,
  historyGroups,
} from './src/data';
import { productRecordToProduct } from './src/productPresentation';
import { shoppingListRecordToItem } from './src/shoppingListPresentation';
import {
  addProductToActiveShoppingList,
  listActiveShoppingItems,
  seedActiveShoppingList,
  toggleShoppingListItem,
} from './src/storage/shoppingLists';
import { createProduct, listProducts, seedInitialProducts } from './src/storage/products';
import { IconName, NewProductInput, Product, ShoppingItem, TabKey } from './src/types';
import { colors, radius, shadow, spacing, typography } from './src/theme';

const tabs: Array<{ key: TabKey; label: string; icon: IconName }> = [
  { key: 'home', label: 'Início', icon: 'home-variant-outline' },
  { key: 'list', label: 'Listas', icon: 'format-list-checks' },
  { key: 'products', label: 'Produtos', icon: 'package-variant-closed' },
  { key: 'future', label: 'Perfil', icon: 'account-outline' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('home');
  const [showNewProduct, setShowNewProduct] = useState(false);
  const [shoppingItems, setShoppingItems] = useState<ShoppingItem[]>([]);
  const [isShoppingListReady, setIsShoppingListReady] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [isProductsReady, setIsProductsReady] = useState(false);
  const [productFormError, setProductFormError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadInitialProducts() {
      try {
        await seedInitialProducts();
        await seedActiveShoppingList();
        const records = await listProducts();
        const listRecords = await listActiveShoppingItems();

        if (isMounted) {
          setProducts(records.map(productRecordToProduct));
          setShoppingItems(listRecords.map(shoppingListRecordToItem));
        }
      } catch (error) {
        console.error('Failed to load products', error);
      } finally {
        if (isMounted) {
          setIsProductsReady(true);
          setIsShoppingListReady(true);
        }
      }
    }

    loadInitialProducts();

    return () => {
      isMounted = false;
    };
  }, []);

  async function refreshShoppingItems() {
    const listRecords = await listActiveShoppingItems();
    setShoppingItems(listRecords.map(shoppingListRecordToItem));
  }

  async function toggleItem(id: number) {
    await toggleShoppingListItem(id);
    await refreshShoppingItems();
  }

  function openNewProduct() {
    setProductFormError(null);
    setShowNewProduct(true);
  }

  async function handleCreateProduct(input: NewProductInput) {
    try {
      setProductFormError(null);
      await createProduct(input);
      const records = await listProducts();
      setProducts(records.map(productRecordToProduct));
      setShowNewProduct(false);
      setActiveTab('products');
    } catch (error) {
      setProductFormError(getProductErrorMessage(error));
    }
  }

  async function handleAddProductToList(product: Product) {
    if (!product.id) {
      return;
    }

    await addProductToActiveShoppingList(product.id);
    await refreshShoppingItems();
    setActiveTab('list');
  }

  const checkedCount = shoppingItems.filter((item) => item.checked).length;

  return (
    <SafeAreaProvider>
      <View style={styles.appShell}>
        <StatusBar style="dark" backgroundColor={colors.bg} />
        <SafeAreaView style={styles.safeArea} edges={['top']}>
          {activeTab === 'home' ? (
            <HomeScreen
              onOpenList={() => setActiveTab('list')}
              onOpenHistory={() => setActiveTab('history')}
              onNewProduct={openNewProduct}
              onAddProductToList={handleAddProductToList}
              products={products.slice(0, 2)}
              isProductsReady={isProductsReady}
              checkedCount={checkedCount}
              totalCount={shoppingItems.length}
            />
          ) : null}
          {activeTab === 'list' ? (
            <ShoppingListScreen
              items={shoppingItems}
              isReady={isShoppingListReady}
              onBack={() => setActiveTab('home')}
              onToggleItem={toggleItem}
            />
          ) : null}
          {activeTab === 'products' ? (
            <ProductsScreen products={products} isProductsReady={isProductsReady} onAddProductToList={handleAddProductToList} />
          ) : null}
          {activeTab === 'history' ? <HistoryScreen /> : null}
          {activeTab === 'future' ? <FutureScreen /> : null}
        </SafeAreaView>

        {activeTab === 'list' ? <FinalizeBar /> : null}
        {activeTab !== 'list' ? (
          <BottomNavigation
            activeTab={activeTab}
            onChange={setActiveTab}
            onAdd={openNewProduct}
          />
        ) : null}

        <NewProductSheet
          visible={showNewProduct}
          errorMessage={productFormError}
          onClose={() => setShowNewProduct(false)}
          onSave={handleCreateProduct}
        />
      </View>
    </SafeAreaProvider>
  );
}

function HomeScreen({
  onOpenList,
  onOpenHistory,
  onNewProduct,
  onAddProductToList,
  products,
  isProductsReady,
  checkedCount,
  totalCount,
}: {
  onOpenList: () => void;
  onOpenHistory: () => void;
  onNewProduct: () => void;
  onAddProductToList: (product: Product) => void;
  products: Product[];
  isProductsReady: boolean;
  checkedCount: number;
  totalCount: number;
}) {
  return (
    <ScreenScroll>
      <Header
        eyebrow="Sábado, 5 de junho"
        title="Olá, Marina"
        actions={
          <>
            <IconButton icon="magnify" />
            <IconButton icon="bell-outline" badge />
          </>
        }
      />
      <ActiveListCard checkedCount={checkedCount} totalCount={totalCount} onOpen={onOpenList} />
      <QuickActions onNewProduct={onNewProduct} onNewList={onOpenList} onHistory={onOpenHistory} />
      <SuggestionCard />
      <SectionTitle title="Você costuma comprar" action="Ver tudo" />
      <ProductListPreview products={products} isReady={isProductsReady} onAdd={onAddProductToList} />
    </ScreenScroll>
  );
}

function ShoppingListScreen({
  items,
  isReady,
  onBack,
  onToggleItem,
}: {
  items: ShoppingItem[];
  isReady: boolean;
  onBack: () => void;
  onToggleItem: (id: number) => void;
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
            <Text style={styles.titleText}>Compra da Semana</Text>
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
            <ShoppingItemRow key={item.id} item={item} onToggle={() => onToggleItem(item.id)} />
          ))}
        </View>
      ))}
    </ScreenScroll>
  );
}

function ProductsScreen({
  products,
  isProductsReady,
  onAddProductToList,
}: {
  products: Product[];
  isProductsReady: boolean;
  onAddProductToList: (product: Product) => void;
}) {
  return (
    <ScreenScroll>
      <Header
        eyebrow="Catálogo da casa"
        title="Produtos"
        actions={<IconButton icon="tune-variant" />}
      />
      <SearchBox placeholder="Buscar produto..." />
      <ChipRow chips={['Todos', 'Hortifrúti', 'Laticínios', 'Limpeza', 'Bebidas']} selected="Todos" />
      <ProductList products={products} isReady={isProductsReady} onAdd={onAddProductToList} />
    </ScreenScroll>
  );
}

function HistoryScreen() {
  return (
    <ScreenScroll>
      <Header
        eyebrow="Suas compras anteriores"
        title="Histórico"
        actions={<IconButton icon="calendar-month-outline" />}
      />
      {historyGroups.map((group) => (
        <View key={group.title}>
          <Text style={styles.historyGroupTitle}>{group.title}</Text>
          {group.items.map((item) => (
            <HistoryCard key={item.title} item={item} />
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
  checkedCount,
  totalCount,
  onOpen,
}: {
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
          <Text style={styles.activeTitle}>Compra da Semana</Text>
          <Text style={styles.subtleText}>{checkedCount} de {totalCount} itens comprados</Text>
        </View>
        <View style={styles.ring}>
          <Text style={styles.ringText}>{progressLabel}%</Text>
        </View>
      </View>
      <ProgressBar progress={progress} />
      <View style={styles.activeFooter}>
        <View>
          <Text style={styles.subtleText}>Estimado</Text>
          <Text style={styles.estimateText}>R$ 247,90</Text>
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

function SuggestionCard() {
  return (
    <View style={styles.suggestionCard}>
      <IconBubble icon="auto-fix" background={colors.indigoSoft} tint={colors.indigo} size={44} />
      <View style={styles.suggestionText}>
        <Text style={styles.suggestionLabel}>Sugestão de recompra</Text>
        <Text style={styles.suggestionTitle}>Café costuma acabar agora</Text>
        <Text style={styles.subtleText}>comprado há 3 semanas</Text>
      </View>
      <View style={styles.suggestionAdd}>
        <MaterialCommunityIcons name="plus" size={20} color={colors.surface} />
      </View>
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

function ProductRow({ product, onAdd }: { product: Product; onAdd: (product: Product) => void }) {
  return (
    <View style={styles.productRow}>
      <IconBubble icon={product.icon} background={product.background} tint={product.tint} size={44} />
      <View style={styles.productText}>
        <Text style={styles.productName} numberOfLines={1}>{product.name}</Text>
        <Text style={styles.productMeta} numberOfLines={1}>{product.meta}</Text>
      </View>
      <Pressable style={styles.addMini} onPress={() => onAdd(product)}>
        <MaterialCommunityIcons name="plus" size={18} color={colors.primaryStrong} />
      </Pressable>
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
  onAdd,
}: {
  products: Product[];
  isReady: boolean;
  onAdd: (product: Product) => void;
}) {
  if (!isReady) {
    return <EmptyState title="Carregando produtos" description="Buscando o catálogo salvo localmente." />;
  }

  if (products.length === 0) {
    return <EmptyState title="Catálogo vazio" description="Toque no botão central para cadastrar seu primeiro produto." />;
  }

  return products.map((product) => (
    <ProductRow key={product.id ?? product.name} product={product} onAdd={onAdd} />
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

function SearchBox({ placeholder }: { placeholder: string }) {
  return (
    <View style={styles.searchBox}>
      <MaterialCommunityIcons name="magnify" size={20} color={colors.ink3} />
      <Text style={styles.searchPlaceholder}>{placeholder}</Text>
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

function ShoppingItemRow({ item, onToggle }: { item: ShoppingItem; onToggle: () => void }) {
  return (
    <Pressable style={styles.shoppingItem} onPress={onToggle}>
      <View style={[styles.checkBox, item.checked ? styles.checkBoxDone : null]}>
        {item.checked ? <MaterialCommunityIcons name="check" size={16} color={colors.surface} /> : null}
      </View>
      <View style={styles.shoppingItemText}>
        <Text style={[styles.productName, item.checked ? styles.checkedText : null]} numberOfLines={1}>{item.name}</Text>
        {item.missing ? <MissingBadge /> : <Text style={styles.productMeta}>{item.meta}</Text>}
      </View>
      <View style={styles.quantityPill}>
        <View style={styles.qtyButton}><MaterialCommunityIcons name="minus" size={14} color={colors.ink2} /></View>
        <Text style={styles.quantityText}>{item.quantity}</Text>
        <View style={styles.qtyButton}><MaterialCommunityIcons name="plus" size={14} color={colors.ink2} /></View>
      </View>
    </Pressable>
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

function HistoryCard({ item }: { item: (typeof historyGroups)[number]['items'][number] }) {
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

function FinalizeBar() {
  return (
    <SafeAreaView edges={['bottom']} style={styles.finalizeShell}>
      <Pressable style={styles.finalizeButton}>
        <MaterialCommunityIcons name="shopping-outline" size={22} color={colors.surface} />
        <Text style={styles.finalizeText}>Finalizar compra · R$ 247,90</Text>
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
  return (
    <SafeAreaView edges={['bottom']} style={styles.bottomShell}>
      <View style={styles.bottomBar}>
        <TabButton tab={tabs[0]} active={activeTab === tabs[0].key} onPress={() => onChange(tabs[0].key)} />
        <TabButton tab={tabs[1]} active={activeTab === tabs[1].key || activeTab === 'history'} onPress={() => onChange(tabs[1].key)} />
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
  errorMessage,
  onClose,
  onSave,
}: {
  visible: boolean;
  errorMessage: string | null;
  onClose: () => void;
  onSave: (input: NewProductInput) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Mercearia');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setName('');
      setCategory('Mercearia');
      setIsSaving(false);
    }
  }, [visible]);

  async function handleSave() {
    if (isSaving) {
      return;
    }

    setIsSaving(true);
    await onSave({ name, category });
    setIsSaving(false);
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalScrim} onPress={onClose} />
      <SafeAreaView edges={['bottom']} style={styles.sheetShell}>
        <View style={styles.sheetHandle} />
        <Text style={styles.sheetTitle}>Novo produto</Text>
        <Text style={styles.sheetSubtitle}>Só o nome já basta. O resto é opcional.</Text>
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
        <View style={styles.optionalRow}>
          <OptionalCapture icon="camera-outline" label="Foto (opcional)" />
          <OptionalCapture icon="barcode-scan" label="Código (opcional)" />
        </View>
        <Pressable style={[styles.saveButton, isSaving ? styles.saveButtonDisabled : null]} onPress={handleSave}>
          <MaterialCommunityIcons name="check" size={20} color={colors.surface} />
          <Text style={styles.saveButtonText}>{isSaving ? 'Salvando...' : 'Salvar produto'}</Text>
        </Pressable>
      </SafeAreaView>
    </Modal>
  );
}

function OptionalCapture({ icon, label }: { icon: IconName; label: string }) {
  return (
    <View style={styles.optionalCapture}>
      <MaterialCommunityIcons name={icon} size={22} color={colors.ink3} />
      <Text style={styles.optionalText}>{label}</Text>
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

function getProductErrorMessage(error: unknown) {
  if (error instanceof Error) {
    if (error.message === 'PRODUCT_NAME_REQUIRED') {
      return 'Informe o nome do produto.';
    }

    if (error.message === 'PRODUCT_ALREADY_EXISTS') {
      return 'Esse produto já está cadastrado.';
    }
  }

  return 'Não foi possível salvar o produto agora.';
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
  productText: {
    flex: 1,
  },
  productName: {
    ...typography.labelStrong,
    color: colors.ink,
  },
  productMeta: {
    ...typography.bodySmall,
    color: colors.ink3,
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
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line2,
    paddingHorizontal: 13,
    paddingVertical: 11,
    marginBottom: 7,
    ...shadow.small,
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
    minWidth: 34,
    textAlign: 'center',
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
