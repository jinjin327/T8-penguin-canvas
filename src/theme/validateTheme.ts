import { getTemplateMode } from './defaultTemplates';
import type { ThemeMode, ThemeTemplate } from './types';

function parseHex(input: string) {
  const s = String(input || '').trim();
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (!m) return null;
  const hex = m[1].length === 3
    ? m[1].split('').map((c) => c + c).join('')
    : m[1];
  const n = Number.parseInt(hex, 16);
  return {
    r: (n >> 16) & 255,
    g: (n >> 8) & 255,
    b: n & 255,
  };
}

function channel(v: number) {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance(hex: string) {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

export function contrastRatio(a: string, b: string) {
  const la = luminance(a);
  const lb = luminance(b);
  if (la == null || lb == null) return null;
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

export function getThemeContrastWarnings(template: ThemeTemplate, mode: ThemeMode) {
  const tokens = getTemplateMode(template, mode).tokens;
  const pairs: Array<[string, string, string]> = [
    ['应用背景文字', tokens.appBg, tokens.textMain],
    ['面板文字', tokens.panelBg, tokens.textMain],
    ['节点文字', tokens.nodeBg, tokens.textMain],
    ['弱提示文字', tokens.panelBg, tokens.textMuted],
    ['主按钮文字', tokens.accent, tokens.accentText],
  ];
  const warnings: string[] = [];
  for (const [label, bg, fg] of pairs) {
    const ratio = contrastRatio(bg, fg);
    if (ratio != null && ratio < 4.5) {
      warnings.push(`${label} 对比度 ${ratio.toFixed(2)}，建议至少 4.5`);
    }
  }
  return warnings;
}
