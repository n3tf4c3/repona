import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function relativeLuminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)!
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function readColor(source: string, token: string): string {
  const match = source.match(new RegExp(`\\b${token}:\\s*'(?<color>#[0-9A-Fa-f]{6})'`));
  assert.ok(match?.groups?.color, `token ${token} deve existir no tema`);
  return match.groups.color;
}

test('cores de texto pequenas atendem ao contraste WCAG AA', () => {
  const source = readFileSync('src/theme.ts', 'utf8');
  const surface = readColor(source, 'surface');
  const background = readColor(source, 'bg');
  const faint = readColor(source, 'ink3');
  const primary = readColor(source, 'primary');

  assert.ok(contrastRatio(faint, surface) >= 4.5);
  assert.ok(contrastRatio(faint, background) >= 4.5);
  assert.ok(contrastRatio(surface, primary) >= 4.5);
});
