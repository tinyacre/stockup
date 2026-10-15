export const themes = ['tool', 'price-tag'] as const;
export type Theme = (typeof themes)[number];

export const themeLabels: Record<Theme, string> = { tool: '简洁', 'price-tag': '醒目' };

// index.html reads this key before the first paint, so a reload opens in the account's last theme.
const storageKey = 'stockup:theme';

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  const bar = getComputedStyle(document.documentElement).getPropertyValue('--rail').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bar);
  try {
    localStorage.setItem(storageKey, theme);
  } catch {
    // Storage can be unavailable, as in some private windows; the server still holds the choice.
  }
}
