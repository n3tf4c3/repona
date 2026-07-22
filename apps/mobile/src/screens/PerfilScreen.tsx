// Tela Perfil ("Casa Repona"): conta, token e sincronização com a nuvem
// (extraída de App.tsx, auditoria 2026-06-09 #12.1).
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { CASA_CODE_LENGTH } from '@repona/core';
import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';

import { Header, IconBubble, ScreenScroll } from '../components/ui';
import {
  criarConta,
  excluirConta,
  getCasaCode,
  getLastSyncAt,
  pairAndSync,
  syncNow,
  unpairCasa,
  type SyncResult,
} from '../storage/syncClient';
import { styles } from '../styles';
import { colors } from '../theme';

export function FutureScreen({ onSynced }: { onSynced: () => void }) {
  return (
    // Sem o KeyboardAvoidingView o teclado do Android cobre os campos de conta
    // e token; com ele o scroll encolhe e o campo focado fica visível.
    <KeyboardAvoidingView
      style={styles.sheetKeyboardWrap}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
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
    </KeyboardAvoidingView>
  );
}

const SYNC_ERROR_MESSAGES: Record<Exclude<SyncResult, { ok: true }>['error'], string> = {
  NOT_PAIRED: 'Crie uma conta ou conecte com um token primeiro.',
  INVALID_CODE: `Token inválido. Use os ${CASA_CODE_LENGTH} caracteres do código da casa.`,
  NETWORK: 'Sem conexão. O backup precisa de internet para ser ativado.',
  CASA_NOT_FOUND: 'Nenhuma conta encontrada com esse token.',
  BUSY: 'Outro aparelho está sincronizando agora. Tente de novo em instantes.',
  SYNC_LIMIT: 'Uma página de backup excedeu o limite seguro. Atualize o app e tente novamente.',
  ACCOUNT_STATE_CONFLICT:
    'Já existe uma conta ou conexão pendente neste aparelho. Continue com o token salvo ou desconecte antes de tentar outra.',
  SERVER: 'O servidor recusou a operação. Tente de novo.',
};

function formatSyncMoment(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'agora';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)} às ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function CasaSyncCard({ onSynced }: { onSynced: () => void }) {
  const [code, setCode] = useState('');
  const [showTokenInput, setShowTokenInput] = useState(false);
  // Tri-state: undefined = carregando (leitura do SecureStore em andamento),
  // null = não pareado, string = pareado. Antes null valia por "carregando" E
  // "não pareado", então durante a leitura async a UI mostrava "Ativar backup"
  // habilitado e um toque podia criar outra casa por cima da credencial
  // existente. (auditoria #80)
  const [pairedCode, setPairedCode] = useState<string | null | undefined>(undefined);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tokenCopied, setTokenCopied] = useState(false);
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
    // finally garante que a UI saia do estado ocupado mesmo se um passo local
    // (ex.: getCasaCode no SQLite) falhar. (auditoria #57)
    try {
      const result = await criarConta();
      handleResult(result);
    } finally {
      try {
        // O POST pode ter sido confirmado antes de uma falha de rede/sync. A
        // releitura expõe o token pendente e tira da tela ações conflitantes.
        setPairedCode(await getCasaCode());
      } finally {
        setBusy(false);
      }
    }
  }

  async function handlePair() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await pairAndSync(code);
      if (result.ok) {
        setCode('');
      }
      handleResult(result);
    } finally {
      try {
        // Mesmo com falha, a sessão pull-only preserva a credencial tentada;
        // refletimos esse estado para impedir que outro token a substitua.
        setPairedCode(await getCasaCode());
      } finally {
        setBusy(false);
      }
    }
  }

  async function handleSync() {
    setBusy(true);
    setMessage(null);
    try {
      handleResult(await syncNow());
    } finally {
      try {
        // Reflete o token atual salvo (ex.: após parear numa nova casa).
        setPairedCode(await getCasaCode());
      } finally {
        setBusy(false);
      }
    }
  }

  async function handleCopyToken() {
    if (!pairedCode) return;
    await Clipboard.setStringAsync(pairedCode);
    setTokenCopied(true);
    setTimeout(() => setTokenCopied(false), 1500);
  }

  function handleDeleteAccount() {
    Alert.alert(
      'Excluir conta e dados',
      'Isso apaga a conta e todos os dados na nuvem (produtos, estoque e histórico), para todos os aparelhos com este token, e também remove deste aparelho o arquivo local desta casa. Não há como desfazer.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setBusy(true);
              setMessage(null);
              try {
                const result = await excluirConta();
                if (result.ok) {
                  setPairedCode(null);
                  setLastSyncAt(null);
                  setMessage({ kind: 'ok', text: 'Conta e dados locais desta casa excluídos.' });
                  // Voltou ao escopo local: recarrega a UI do arquivo local em vez
                  // de manter os dados da casa excluída na tela. (auditoria #68)
                  onSynced();
                } else {
                  setMessage({ kind: 'error', text: SYNC_ERROR_MESSAGES[result.error] });
                }
              } finally {
                setBusy(false);
              }
            })();
          },
        },
      ],
    );
  }

  function handleUnpair() {
    Alert.alert('Desconectar da casa', 'Os dados locais continuam no aparelho. Deseja desconectar?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Desconectar',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await unpairCasa();
              setPairedCode(null);
              setLastSyncAt(null);
              setMessage(null);
              // Voltou ao escopo local: recarrega a UI do arquivo local. (auditoria #68)
              onSynced();
            } catch {
              setMessage({
                kind: 'error',
                text: 'Há uma operação de conta pendente. Conclua a atualização/exclusão antes de desconectar.',
              });
            }
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

      {pairedCode === undefined ? (
        <Text style={styles.subtleText}>Carregando…</Text>
      ) : pairedCode ? (
        <>
          <View style={styles.syncPairedRow}>
            <View style={styles.syncTokenHeader}>
              <Text style={styles.syncPairedLabel}>Token de acesso</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Copiar token de acesso"
                style={styles.syncCopyButton}
                onPress={handleCopyToken}
              >
                <MaterialCommunityIcons
                  name={tokenCopied ? 'check' : 'content-copy'}
                  size={16}
                  color={colors.indigo}
                />
                <Text style={styles.syncCopyText}>{tokenCopied ? 'Copiado' : 'Copiar'}</Text>
              </Pressable>
            </View>
            <Text selectable style={styles.syncPairedCode}>{pairedCode}</Text>
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
          <Pressable style={styles.syncUnpairButton} disabled={busy} onPress={handleDeleteAccount}>
            <Text style={styles.syncUnpairText}>Excluir conta e dados</Text>
          </Pressable>
        </>
      ) : (
        <>
          {/* Caminho feliz: um toque, sem digitar nada. O nome nasce automático e
              a nuvem devolve o token, que aparece no bloco pareado acima. */}
          <Pressable
            style={[styles.saveButton, busy ? styles.saveButtonDisabled : null]}
            disabled={busy}
            onPress={handleCreate}
          >
            <MaterialCommunityIcons name="cloud-upload-outline" size={20} color={colors.surface} />
            <Text style={styles.saveButtonText}>{busy ? 'Ativando...' : 'Ativar backup na nuvem'}</Text>
          </Pressable>

          {/* Entrar numa casa que já existe é o caminho secundário — fica atrás de
              um toque para quem realmente tem um código, evitando que alguém crie
              uma casa nova sem querer. */}
          {showTokenInput ? (
            <>
              <View style={styles.syncDivider}>
                <View style={styles.syncDividerLine} />
                <Text style={styles.syncDividerText}>código da casa</Text>
                <View style={styles.syncDividerLine} />
              </View>
              <View style={styles.inputBox}>
                <MaterialCommunityIcons name="key-outline" size={20} color={colors.primaryStrong} />
                <TextInput
                  value={code}
                  onChangeText={(text) => setCode(text.toUpperCase())}
                  style={styles.input}
                  placeholder={`Token (${CASA_CODE_LENGTH} caracteres)`}
                  placeholderTextColor={colors.ink3}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={CASA_CODE_LENGTH}
                />
              </View>
              <Pressable style={styles.syncUnpairButton} disabled={busy} onPress={handlePair}>
                <Text style={styles.syncConnectText}>{busy ? 'Conectando...' : 'Conectar com o código'}</Text>
              </Pressable>
            </>
          ) : (
            <Pressable style={styles.syncUnpairButton} disabled={busy} onPress={() => setShowTokenInput(true)}>
              <Text style={styles.syncConnectText}>Já tenho um código da casa</Text>
            </Pressable>
          )}
        </>
      )}

      {message ? (
        <Text style={message.kind === 'ok' ? styles.syncMessageOk : styles.formError}>{message.text}</Text>
      ) : null}
    </View>
  );
}
