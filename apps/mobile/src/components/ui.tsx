// Primitivos de UI compartilhados entre as telas (extraídos de App.tsx,
// auditoria 2026-06-09 #12.1).
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import type { PriceSummary } from '@repona/core';

import { formatCentsBRL } from '../priceFormat';
import { styles } from '../styles';
import { colors } from '../theme';
import type { IconName } from '../types';

export function ScreenScroll({ children, bottomPadding = 112 }: { children: ReactNode; bottomPadding?: number }) {
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

export function Header({ eyebrow, title, actions }: { eyebrow: string; title: string; actions?: ReactNode }) {
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

export function IconButton({
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

export function SectionTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
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

export function EmptyState({ title, description }: { title: string; description: string }) {
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

export function SearchBox({
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

export function ChipRow({
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

export function CategoryHeader({ title, count, color }: { title: string; count: number; color: string }) {
  return (
    <View style={styles.categoryHeader}>
      <View style={[styles.categoryDot, { backgroundColor: color }]} />
      <Text style={styles.categoryTitle}>{title}</Text>
      <Text style={styles.categoryCount}>{count} itens</Text>
    </View>
  );
}

export function MissingBadge() {
  return (
    <View style={styles.missingBadge}>
      <MaterialCommunityIcons name="alert-circle-outline" size={13} color={colors.coral} />
      <Text style={styles.missingText}>Em falta em casa</Text>
    </View>
  );
}

export function PriceSummaryLine({ summary }: { summary: PriceSummary }) {
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

export function MetaLabel({ icon, label }: { icon: IconName; label: string }) {
  return (
    <View style={styles.metaLabel}>
      <MaterialCommunityIcons name={icon} size={14} color={colors.ink3} />
      <Text style={styles.metaLabelText}>{label}</Text>
    </View>
  );
}

export function ProgressBar({ progress }: { progress: number }) {
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${Math.max(0, Math.min(progress, 1)) * 100}%` }]} />
    </View>
  );
}

export function IconBubble({
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

export function StatusPill({ label, background, tint }: { label: string; background: string; tint: string }) {
  return (
    <View style={[styles.statusPill, { backgroundColor: background }]}>
      <Text style={[styles.statusPillText, { color: tint }]}>{label}</Text>
    </View>
  );
}
