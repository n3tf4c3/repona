// Tela Perfil ("Casa Repona"): conta, token e sincronização com a nuvem
// (extraída de App.tsx, auditoria 2026-06-09 #12.1).
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';

import { Header, IconBubble, ScreenScroll } from '../components/ui';
import {
  criarConta,
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
  BUSY: 'Outro aparelho está sincronizando agora. Tente de novo em instantes.',
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
