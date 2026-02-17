import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import startupEn from '../../i18n/locales/en/Startup.json';
import profileCreateEn from '../../i18n/locales/en/ProfileCreate.json';
import loginEn from '../../i18n/locales/en/LogIn.json';
import vaultEn from '../../i18n/locales/en/Vault.json';
import dataCardsEn from '../../i18n/locales/en/DataCards.json';
import bankCardsEn from '../../i18n/locales/en/BankCards.json';
import commonEn from '../../i18n/locales/en/Common.json';
import tooltipsEn from '../../i18n/locales/en/Tooltips.json';
import searchEn from '../../i18n/locales/en/Search.json';
import foldersEn from '../../i18n/locales/en/Folders.json';
import detailsEn from '../../i18n/locales/en/Details.json';
import workspaceEn from '../../i18n/locales/en/Workspace.json';

import startupRu from '../../i18n/locales/ru/Startup.json';
import profileCreateRu from '../../i18n/locales/ru/ProfileCreate.json';
import loginRu from '../../i18n/locales/ru/LogIn.json';
import vaultRu from '../../i18n/locales/ru/Vault.json';
import dataCardsRu from '../../i18n/locales/ru/DataCards.json';
import bankCardsRu from '../../i18n/locales/ru/BankCards.json';
import commonRu from '../../i18n/locales/ru/Common.json';
import tooltipsRu from '../../i18n/locales/ru/Tooltips.json';
import searchRu from '../../i18n/locales/ru/Search.json';
import foldersRu from '../../i18n/locales/ru/Folders.json';
import detailsRu from '../../i18n/locales/ru/Details.json';
import workspaceRu from '../../i18n/locales/ru/Workspace.json';

type Dictionaries = {
  Common: typeof commonEn;
  Tooltips: typeof tooltipsEn;
  Startup: typeof startupEn;
  ProfileCreate: typeof profileCreateEn;
  LogIn: typeof loginEn;
  Vault: typeof vaultEn;
  DataCards: typeof dataCardsEn;
  BankCards: typeof bankCardsEn;
  Search: typeof searchEn;
  Folders: typeof foldersEn;
  Details: typeof detailsEn;
  Workspace: typeof workspaceEn;
};

export type Namespace = keyof Dictionaries;
export type Language = 'en' | 'ru';

const FALLBACK_LANGUAGE: Language = 'en';
const LANGUAGE_STORAGE_KEY = 'uiLanguage';

const hasOwn = (obj: object, prop: string) => Object.prototype.hasOwnProperty.call(obj, prop);

const isSupportedLanguage = (value: unknown): value is Language => value === 'en' || value === 'ru';

const normalizeLanguage = (value: unknown): Language =>
  isSupportedLanguage(value) ? value : FALLBACK_LANGUAGE;

const getWindow = (): Window | null => (typeof window === 'undefined' ? null : window);

const readStoredLanguage = (): Language | null => {
  const win = getWindow();
  if (!win) {
    return null;
  }

  try {
    const value = win.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (!value) {
      return null;
    }
    return isSupportedLanguage(value) ? value : null;
  } catch {
    return null;
  }
};

const persistLanguage = (language: Language): void => {
  const win = getWindow();
  if (!win) {
    return;
  }

  try {
    win.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Ignore storage errors in restricted environments.
  }
};

const applyDocumentLanguage = (language: Language): void => {
  const win = getWindow();
  if (!win) {
    return;
  }

  win.document.documentElement.lang = normalizeLanguage(language);
};

const resolveInitialLanguage = (): Language => readStoredLanguage() ?? FALLBACK_LANGUAGE;

const resolveI18nValue = (dict: unknown, key: string): unknown => {
  if (!dict || typeof dict !== 'object') return undefined;

  const record = dict as Record<string, unknown>;

  // 1) Preserve existing flat keys (including those with dots)
  if (hasOwn(record, key)) return record[key];

  // 2) Try deep lookup only if key looks like a path
  if (!key.includes('.')) return undefined;

  let current: unknown = record;
  for (const part of key.split('.')) {
    if (!current || typeof current !== 'object') return undefined;
    const curRec = current as Record<string, unknown>;
    if (!hasOwn(curRec, part)) return undefined;
    current = curRec[part];
  }

  return current;
};

const dictionariesByLanguage: Record<Language, Dictionaries> = {
  en: {
    Common: commonEn,
    Tooltips: tooltipsEn,
    Startup: startupEn,
    ProfileCreate: profileCreateEn,
    LogIn: loginEn,
    Vault: vaultEn,
    DataCards: dataCardsEn,
    BankCards: bankCardsEn,
    Search: searchEn,
    Folders: foldersEn,
    Details: detailsEn,
    Workspace: workspaceEn,
  },
  ru: {
    Common: commonRu,
    Tooltips: tooltipsRu,
    Startup: startupRu,
    ProfileCreate: profileCreateRu,
    LogIn: loginRu,
    Vault: vaultRu,
    DataCards: dataCardsRu,
    BankCards: bankCardsRu,
    Search: searchRu,
    Folders: foldersRu,
    Details: detailsRu,
    Workspace: workspaceRu,
  },
};

let globalLanguage: Language = resolveInitialLanguage();
applyDocumentLanguage(globalLanguage);

type I18nContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
};

const I18nContext = createContext<I18nContextValue>({
  language: globalLanguage,
  setLanguage: () => {},
});

export const I18nProvider = ({ children }: { children: ReactNode }) => {
  const [language, setLanguageState] = useState<Language>(() => globalLanguage);

  const setLanguage = useCallback((nextLanguage: Language) => {
    setLanguageState(normalizeLanguage(nextLanguage));
  }, []);

  useEffect(() => {
    globalLanguage = normalizeLanguage(language);
    applyDocumentLanguage(globalLanguage);
    persistLanguage(globalLanguage);
  }, [language]);

  const value = useMemo(
    () => ({ language, setLanguage }),
    [language, setLanguage]
  );

  return React.createElement(I18nContext.Provider, { value }, children);
};

export const useI18n = () => useContext(I18nContext);

export const useTranslation = (namespace?: Namespace) => {
  const { language } = useI18n();

  const activeLanguageDictionaries = useMemo(
    () => dictionariesByLanguage[normalizeLanguage(language)] ?? dictionariesByLanguage[FALLBACK_LANGUAGE],
    [language]
  );

  const dict = useMemo(
    () => (namespace ? activeLanguageDictionaries[namespace] : undefined),
    [activeLanguageDictionaries, namespace]
  );

  const fallbackDict = useMemo(
    () => (namespace ? dictionariesByLanguage[FALLBACK_LANGUAGE][namespace] : undefined),
    [namespace]
  );

  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string => {
      const localized = resolveI18nValue(dict, key);
      const fallback = resolveI18nValue(fallbackDict, key);
      const value = typeof localized === 'string' ? localized : fallback;
      if (typeof value !== 'string') return key;

      let result = value;
      if (params) {
        Object.entries(params).forEach(([paramKey, value]) => {
          const pattern = new RegExp(`{{${paramKey}}}`, 'g');
          result = result.replace(pattern, String(value));
        });
      }

      return result;
    },
    [dict, fallbackDict]
  );

  return useMemo(() => ({ t }), [t]);
};

export const tGlobal = (
  namespace: Namespace,
  key: string,
  params?: Record<string, string | number>
): string => {
  const language = normalizeLanguage(globalLanguage);
  const localizedDict = dictionariesByLanguage[language][namespace];
  const fallbackDict = dictionariesByLanguage[FALLBACK_LANGUAGE][namespace];

  const localized = resolveI18nValue(localizedDict, key);
  const fallback = resolveI18nValue(fallbackDict, key);
  const value = typeof localized === 'string' ? localized : fallback;
  if (typeof value !== 'string') return key;

  let result = value;
  if (params) {
    Object.entries(params).forEach(([paramKey, value]) => {
      const pattern = new RegExp(`{{${paramKey}}}`, 'g');
      result = result.replace(pattern, String(value));
    });
  }

  return result;
};

export const getCurrentLanguage = (): Language => globalLanguage;

export const coerceLanguage = (value: unknown): Language => normalizeLanguage(value);
