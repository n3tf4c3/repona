// Modais do app: cadastro/edição de produto (com câmera e scanner), preço,
// quantidade e detalhe de compra (extraídos de App.tsx, auditoria 2026-06-09
// #12.1).
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import type { BarcodeScanningResult } from 'expo-camera';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { buildQuantityString, CATEGORIAS, estimateShoppingTotal, FIELD_LIMITS, type PriceSummary } from '@repona/core';

import { formatCentsBRL, parsePriceToCents } from '../priceFormat';
import type { PurchaseHistoryItem } from '../purchaseHistoryPresentation';
import { buscarProdutoPorCodigo } from '../services/openFoodFacts';
import { findProductByBarcode } from '../storage/products';
import { styles } from '../styles';
import { colors } from '../theme';
import type { IconName, NewProductInput, Product, ShoppingItem } from '../types';
import { ChipRow } from './ui';

export function PriceEntryModal({
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
      <KeyboardAvoidingView
        style={styles.sheetKeyboardWrap}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
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
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function PurchaseDetailModal({
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

export function NewProductSheet({
  visible,
  product,
  initialBarcode = null,
  errorMessage,
  onClose,
  onSave,
}: {
  visible: boolean;
  product: Product | null;
  // Código pré-preenchido para produto novo (vindo do scanner da compra).
  initialBarcode?: string | null;
  errorMessage: string | null;
  onClose: () => void;
  onSave: (input: NewProductInput) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Mercearia');
  const [brand, setBrand] = useState('');
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
  const [isBuscandoDados, setIsBuscandoDados] = useState(false);
  // Sugestão do Open Food Facts quando o nome já está preenchido: o usuário
  // toca para aplicar em vez de ter o texto sobrescrito.
  const [offSugestao, setOffSugestao] = useState<{ nome: string; marca: string | null; imagemUrl: string | null } | null>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const photoCameraRef = useRef<CameraView>(null);
  // Último código consultado no Open Food Facts: evita repetir a chamada e
  // descarta resposta atrasada de um código anterior.
  const ultimaBuscaRef = useRef<string | null>(null);

  useEffect(() => {
    if (visible) {
      setName(product?.name ?? '');
      setCategory(product?.category ?? 'Mercearia');
      setBrand(product?.brand ?? '');
      setBarcode(product?.barcode ?? initialBarcode);
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
      setIsBuscandoDados(false);
      setOffSugestao(null);
      ultimaBuscaRef.current = null;
      // Cadastro novo vindo do scanner da compra: tenta pré-preencher pela
      // internet enquanto o usuário vê o formulário.
      if (!product && initialBarcode) {
        void prefillFromBarcode(initialBarcode);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product, initialBarcode, visible]);

  // Busca dados no Open Food Facts. Nome vazio: preenche direto (com a foto).
  // Nome já preenchido: vira sugestão tocável, sem sobrescrever o usuário.
  // Falha em silêncio: o cadastro manual continua o caminho normal.
  async function prefillFromBarcode(code: string) {
    if (ultimaBuscaRef.current === code) return;
    ultimaBuscaRef.current = code;
    setOffSugestao(null);
    setIsBuscandoDados(true);
    const dados = await buscarProdutoPorCodigo(code);
    if (ultimaBuscaRef.current !== code) return;
    setIsBuscandoDados(false);
    if (!dados) return;
    const sugerido = [dados.nome, dados.quantidade]
      .filter(Boolean)
      .join(' ')
      .slice(0, FIELD_LIMITS.name);
    let aplicado = false;
    setName((atual) => {
      if (atual.trim()) return atual;
      aplicado = true;
      return sugerido;
    });
    if (aplicado) {
      if (dados.marca) setBrand((atual) => (atual.trim() ? atual : dados.marca ?? ''));
      if (dados.imagemUrl) setPhotoUri((atual) => atual ?? dados.imagemUrl);
    } else {
      setOffSugestao({ nome: sugerido, marca: dados.marca, imagemUrl: dados.imagemUrl });
    }
  }

  function aplicarSugestaoOFF() {
    if (!offSugestao) return;
    setName(offSugestao.nome);
    if (offSugestao.marca) setBrand((atual) => (atual.trim() ? atual : offSugestao.marca ?? ''));
    if (offSugestao.imagemUrl) setPhotoUri((atual) => atual ?? offSugestao.imagemUrl);
    setOffSugestao(null);
  }

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

  async function handleBarcodeScanned(result: BarcodeScanningResult) {
    if (hasScanned) {
      return;
    }

    setHasScanned(true);
    setBarcode(result.data);
    setIsScannerVisible(false);

    // Avisa se o código já pertence a outro produto, para evitar duplicata.
    const existente = await findProductByBarcode(result.data, product?.id);
    if (existente) {
      setBarcodeError(
        existente.archived
          ? `Já existe (arquivado) "${existente.name}" com este código.`
          : `Já existe "${existente.name}" com este código.`,
      );
      return;
    }

    // Busca os dados do código no Open Food Facts (preenche ou sugere).
    void prefillFromBarcode(result.data);
  }

  async function handleSave() {
    if (isSaving) {
      return;
    }

    setIsSaving(true);
    await onSave({
      name,
      category,
      brand: brand.trim() || null,
      barcode,
      photoUri,
      alertThreshold: alertThreshold.trim() || null,
      occasional,
    });
    setIsSaving(false);
  }

  return (
    <>
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
        <KeyboardAvoidingView
          style={styles.sheetKeyboardWrap}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
        <Pressable style={styles.modalScrim} onPress={onClose} />
        {/* flexShrink + ScrollView: com o teclado aberto o sheet encolhe e o
            formulário rola, em vez de os campos de baixo ficarem cobertos. */}
        <SafeAreaView edges={['bottom']} style={[styles.sheetShell, styles.sheetShellShrink]}>
          <View style={styles.sheetHandle} />
          <ScrollView
            contentContainerStyle={styles.sheetScrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
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
              maxLength={FIELD_LIMITS.name}
            />
          </View>
          {errorMessage ? <Text style={styles.formError}>{errorMessage}</Text> : null}
          <Text style={styles.fieldLabel}>Categoria</Text>
          <ChipRow chips={[...CATEGORIAS]} selected={category} onSelect={setCategory} />
          <Text style={styles.fieldLabel}>Marca (opcional)</Text>
          <View style={styles.inputBox}>
            <MaterialCommunityIcons name="tag-text-outline" size={20} color={colors.primaryStrong} />
            <TextInput
              value={brand}
              onChangeText={setBrand}
              style={styles.input}
              placeholder="Ex.: Urbano"
              placeholderTextColor={colors.ink3}
              maxLength={FIELD_LIMITS.brand}
            />
          </View>
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
          {isBuscandoDados ? <Text style={styles.captureResult}>Buscando dados do produto na internet...</Text> : null}
          {offSugestao ? (
            <Pressable onPress={aplicarSugestaoOFF}>
              <Text style={styles.captureResult}>
                Encontrado na internet: {offSugestao.nome} — toque para usar
              </Text>
            </Pressable>
          ) : null}
          {barcodeError ? <Text style={styles.formError}>{barcodeError}</Text> : null}
          <Pressable style={[styles.saveButton, isSaving ? styles.saveButtonDisabled : null]} onPress={handleSave}>
            <MaterialCommunityIcons name="check" size={20} color={colors.surface} />
            <Text style={styles.saveButtonText}>{isSaving ? 'Salvando...' : product ? 'Atualizar produto' : 'Salvar produto'}</Text>
          </Pressable>
          </ScrollView>
        </SafeAreaView>
        </KeyboardAvoidingView>
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

export function OptionalCapture({ icon, label, onPress }: { icon: IconName; label: string; onPress?: () => void }) {
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

// Scanner da compra: lê o código de barras de um produto já cadastrado,
// pergunta a quantidade e adiciona à lista ativa.
export function ScanToListModal({
  visible,
  onClose,
  onAdd,
  onRegister,
}: {
  visible: boolean;
  onClose: () => void;
  onAdd: (productId: number, quantity: string) => void;
  onRegister: (barcode: string) => void;
}) {
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [notFoundCode, setNotFoundCode] = useState<string | null>(null);
  const [foundProduct, setFoundProduct] = useState<{ id: number; name: string } | null>(null);
  const [value, setValue] = useState('1');
  const [unit, setUnit] = useState('un');
  const [quantityError, setQuantityError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      return;
    }
    setHasScanned(false);
    setScanError(null);
    setNotFoundCode(null);
    setFoundProduct(null);
    setValue('1');
    setUnit('un');
    setQuantityError(null);
    setPermissionDenied(false);
    if (!cameraPermission?.granted) {
      void requestCameraPermission().then((permission) => {
        if (!permission.granted) {
          setPermissionDenied(true);
        }
      });
    }
  }, [visible, cameraPermission, requestCameraPermission]);

  async function handleBarcodeScanned(result: BarcodeScanningResult) {
    if (hasScanned) {
      return;
    }

    setHasScanned(true);
    const existente = await findProductByBarcode(result.data);

    if (!existente) {
      setNotFoundCode(result.data);
      return;
    }

    if (existente.archived) {
      setScanError(`"${existente.name}" está arquivado. Restaure-o no catálogo para comprar.`);
      return;
    }

    setFoundProduct({ id: existente.id, name: existente.name });
  }

  function handleRescan() {
    setScanError(null);
    setNotFoundCode(null);
    setHasScanned(false);
  }

  function handleAdd() {
    if (!foundProduct) {
      return;
    }
    const quantidade = buildQuantityString(value, unit);
    if (!quantidade) {
      setQuantityError('Informe uma quantidade válida (ex.: 2).');
      return;
    }
    onAdd(foundProduct.id, quantidade);
  }

  return (
    <>
      <Modal visible={visible && foundProduct === null} animationType="slide" onRequestClose={onClose}>
        <SafeAreaView edges={['top', 'bottom']} style={styles.scannerShell}>
          <View style={styles.scannerHeader}>
            <View>
              <Text style={styles.scannerTitle}>Adicionar pela câmera</Text>
              <Text style={styles.scannerSubtitle}>Aponte para o código de barras do produto.</Text>
            </View>
            <Pressable style={styles.scannerClose} onPress={onClose}>
              <MaterialCommunityIcons name="close" size={22} color={colors.surface} />
            </Pressable>
          </View>
          {cameraPermission?.granted ? (
            <CameraView
              style={styles.scannerCamera}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39'] }}
              onBarcodeScanned={hasScanned ? undefined : (result) => { void handleBarcodeScanned(result); }}
            />
          ) : (
            <View style={styles.scannerCamera} />
          )}
          {notFoundCode ? (
            <>
              <Text style={styles.scannerHint}>Nenhum produto cadastrado com este código.</Text>
              <Pressable style={[styles.saveButton, styles.scannerRetryButton]} onPress={() => onRegister(notFoundCode)}>
                <MaterialCommunityIcons name="plus" size={20} color={colors.surface} />
                <Text style={styles.saveButtonText}>Cadastrar agora</Text>
              </Pressable>
              <Pressable style={[styles.saveButton, styles.scannerRetryButton]} onPress={handleRescan}>
                <MaterialCommunityIcons name="barcode-scan" size={20} color={colors.surface} />
                <Text style={styles.saveButtonText}>Ler outro código</Text>
              </Pressable>
            </>
          ) : scanError ? (
            <>
              <Text style={styles.scannerHint}>{scanError}</Text>
              <Pressable style={[styles.saveButton, styles.scannerRetryButton]} onPress={handleRescan}>
                <MaterialCommunityIcons name="barcode-scan" size={20} color={colors.surface} />
                <Text style={styles.saveButtonText}>Ler outro código</Text>
              </Pressable>
            </>
          ) : (
            <Text style={styles.scannerHint}>
              {permissionDenied
                ? 'Permita acesso à câmera para ler o código.'
                : 'O produto é localizado pelo código de barras já cadastrado.'}
            </Text>
          )}
        </SafeAreaView>
      </Modal>
      <Modal visible={visible && foundProduct !== null} transparent animationType="slide" onRequestClose={onClose}>
        <KeyboardAvoidingView
          style={styles.sheetKeyboardWrap}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
        <Pressable style={styles.modalScrim} onPress={onClose} />
        <SafeAreaView edges={['bottom']} style={styles.sheetShell}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Adicionar à lista</Text>
          <Text style={styles.sheetSubtitle}>{foundProduct?.name ?? ''}</Text>
          <Text style={styles.fieldLabel}>Quantidade</Text>
          <View style={styles.inputBox}>
            <MaterialCommunityIcons name="scale-balance" size={20} color={colors.primaryStrong} />
            <TextInput
              value={value}
              onChangeText={setValue}
              style={styles.input}
              placeholder="Ex.: 2"
              placeholderTextColor={colors.ink3}
              keyboardType="decimal-pad"
              autoFocus
            />
          </View>
          <ChipRow chips={['un', 'kg', 'g']} selected={unit} onSelect={setUnit} />
          {quantityError ? <Text style={styles.formError}>{quantityError}</Text> : null}
          <Pressable style={styles.saveButton} onPress={handleAdd}>
            <MaterialCommunityIcons name="cart-plus" size={20} color={colors.surface} />
            <Text style={styles.saveButtonText}>Adicionar à lista</Text>
          </Pressable>
        </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

export function QuantityEntryModal({
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
    const quantidade = buildQuantityString(value, unit);
    if (!quantidade) {
      setError('Informe uma quantidade válida (ex.: 0,8).');
      return;
    }
    if (item) onSave(item.id, quantidade);
  }

  return (
    <Modal visible={item !== null} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.sheetKeyboardWrap}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
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
      </KeyboardAvoidingView>
    </Modal>
  );
}
