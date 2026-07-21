// Navegação inferior do app (extraída de App.tsx, auditoria 2026-06-09 #12.1).
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { styles } from '../styles';
import { colors } from '../theme';
import type { IconName, TabKey } from '../types';

// Perfil não fica na barra: abre pelo ícone no topo da tela Início.
const tabs: Array<{ key: TabKey; label: string; icon: IconName }> = [
  { key: 'home', label: 'Início', icon: 'home-variant-outline' },
  { key: 'list', label: 'Listas', icon: 'format-list-checks' },
  { key: 'estoque', label: 'Estoque', icon: 'fridge-outline' },
  { key: 'products', label: 'Produtos', icon: 'package-variant-closed' },
];
const historyTab: { key: TabKey; label: string; icon: IconName } = { key: 'history', label: 'Histórico', icon: 'history' };

export function BottomNavigation({
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
        <Pressable
          style={styles.fab}
          onPress={onAdd}
          accessibilityRole="button"
          accessibilityLabel="Novo produto"
        >
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
    <Pressable
      style={styles.tabButton}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={tab.label}
      accessibilityState={{ selected: active }}
    >
      <MaterialCommunityIcons name={tab.icon} size={23} color={active ? colors.primaryStrong : colors.ink3} />
      <Text style={[styles.tabLabel, active ? styles.tabLabelActive : null]}>{tab.label}</Text>
    </Pressable>
  );
}
