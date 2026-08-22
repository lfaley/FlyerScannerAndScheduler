/**
 * Theme resolution.
 *
 * DARK IS THE DEFAULT (v9.9). The setting has three states, and only two of
 * them are a colour:
 *
 *   'dark'   -> dark, always            (the default)
 *   'light'  -> light, always
 *   'system' -> whatever the phone says, and it follows along live
 *
 * CSS alone cannot express the third one -- a prefers-color-scheme media
 * query has no way to mean "only when the user has not chosen". So the
 * resolution happens here and lands on <html data-theme>, which is the only
 * thing css/tokens.css looks at. That also keeps the light palette written
 * once instead of duplicated into a media block, where it would drift.
 *
 * Pure and DOM-free below `applyTheme`, so the resolution rules are testable
 * without a browser.
 */

export const THEMES = ['dark', 'light', 'system'];
export const DEFAULT_THEME = 'dark';

export const THEME_LABELS = {
  dark:   'Dark',
  light:  'Light',
  system: 'Match my phone',
};

/**
 * The stored preference, defended against anything unexpected in a save file.
 * An unknown value must not leave the app themeless.
 */
export function themePref(settings){
  const t = settings && settings.theme;
  return THEMES.includes(t) ? t : DEFAULT_THEME;
}

/**
 * Preference + what the phone reports -> the palette to actually paint.
 * `systemPrefersLight` is passed in rather than read here, so this is pure.
 */
export function resolveTheme(pref, systemPrefersLight){
  const p = THEMES.includes(pref) ? pref : DEFAULT_THEME;
  if(p === 'system') return systemPrefersLight ? 'light' : 'dark';
  return p;
}

/** The browser-chrome colour for a resolved theme. Matches --green in tokens. */
export const THEME_META = { dark: '#2F5D4C', light: '#2D5A4A' };
