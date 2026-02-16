import { resolveAppTheme } from '../shared/lib/tauri';
import { applyTheme, cacheTheme, DEFAULT_APP_THEME, readCachedTheme } from '../shared/lib/theme';

async function bootstrap() {
  const cachedTheme = readCachedTheme();
  if (cachedTheme) {
    applyTheme(cachedTheme);
  }

  try {
    const resolvedTheme = await resolveAppTheme(cachedTheme ?? undefined);
    applyTheme(resolvedTheme);
    cacheTheme(resolvedTheme);
  } catch {
    if (!cachedTheme) {
      applyTheme(DEFAULT_APP_THEME);
      cacheTheme(DEFAULT_APP_THEME);
    }
  } finally {
    void import('./main');
  }
}

void bootstrap();
