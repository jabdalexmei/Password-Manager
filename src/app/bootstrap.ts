const THEME_STORAGE_KEY = 'uiTheme';

const isSupportedTheme = (value: unknown): value is 'blueTheme' | 'darkTheme' =>
  value === 'blueTheme' || value === 'darkTheme';

try {
  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (isSupportedTheme(storedTheme)) {
    document.documentElement.dataset.theme = storedTheme;
  }
} catch {
  // Ignore storage errors in restricted environments.
}

void import('./main');
