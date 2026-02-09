import { useCallback, useMemo } from 'react';
import startup from '../../i18n/locales/en/Startup.json';
import profileCreate from '../../i18n/locales/en/ProfileCreate.json';
import login from '../../i18n/locales/en/LogIn.json';
import vault from '../../i18n/locales/en/Vault.json';
import dataCards from '../../i18n/locales/en/DataCards.json';
import bankCards from '../../i18n/locales/en/BankCards.json';
import common from '../../i18n/locales/en/Common.json';
import tooltips from '../../i18n/locales/en/Tooltips.json';
import search from '../../i18n/locales/en/Search.json';
import folders from '../../i18n/locales/en/Folders.json';
import details from '../../i18n/locales/en/Details.json';
import workspace from '../../i18n/locales/en/Workspace.json';

type Dictionaries = {
  Common: typeof common;
  Tooltips: typeof tooltips;
  Startup: typeof startup;
  ProfileCreate: typeof profileCreate;
  LogIn: typeof login;
  Vault: typeof vault;
  DataCards: typeof dataCards;
  BankCards: typeof bankCards;
  Search: typeof search;
  Folders: typeof folders;
  Details: typeof details;
  Workspace: typeof workspace;
};

const hasOwn = (obj: object, prop: string) => Object.prototype.hasOwnProperty.call(obj, prop);

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

const dictionaries: Dictionaries = {
  Common: common,
  Tooltips: tooltips,
  Startup: startup,
  ProfileCreate: profileCreate,
  LogIn: login,
  Vault: vault,
  DataCards: dataCards,
  BankCards: bankCards,
  Search: search,
  Folders: folders,
  Details: details,
  Workspace: workspace,
};

export type Namespace = keyof Dictionaries;

export const useTranslation = (namespace?: Namespace) => {
  const dict = useMemo(() => (namespace ? dictionaries[namespace] : undefined), [namespace]);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string => {
      const value = resolveI18nValue(dict, key);
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
    [dict]
  );

  return useMemo(() => ({ t }), [t]);
};

export const tGlobal = (
  namespace: Namespace,
  key: string,
  params?: Record<string, string | number>
): string => {
  const dict = dictionaries[namespace];
  const value = resolveI18nValue(dict, key);
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
