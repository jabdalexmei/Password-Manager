export type AppTheme = 'blueTheme' | 'darkTheme';

export const THEME_STORAGE_KEY = 'uiTheme';
const LEGACY_THEME_STORAGE_KEYS = ['theme'];
export const DEFAULT_APP_THEME: AppTheme = 'blueTheme';

export const isSupportedTheme = (value: unknown): value is AppTheme =>
  value === 'blueTheme' || value === 'darkTheme';

export const applyTheme = (theme: AppTheme) => {
  document.documentElement.dataset.theme = theme;
};

const readStorage = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

export const readCachedTheme = (): AppTheme | null => {
  const current = readStorage(THEME_STORAGE_KEY);
  if (isSupportedTheme(current)) {
    return current;
  }

  for (const legacyKey of LEGACY_THEME_STORAGE_KEYS) {
    const legacyValue = readStorage(legacyKey);
    if (isSupportedTheme(legacyValue)) {
      cacheTheme(legacyValue);
      try {
        window.localStorage.removeItem(legacyKey);
      } catch {
        // Ignore storage errors in restricted environments.
      }
      return legacyValue;
    }
  }

  return null;
};

export const cacheTheme = (theme: AppTheme) => {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Ignore storage errors in restricted environments.
  }
};
