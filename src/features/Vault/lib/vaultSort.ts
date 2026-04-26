import { BankCardSummary, DataCardSummary } from '../types/ui';

export type VaultSortMode =
  | 'name_asc'
  | 'name_desc'
  | 'updated_desc'
  | 'updated_asc'
  | 'created_desc'
  | 'created_asc';

export type VaultSortKind = 'data_cards' | 'bank_cards';

export const DEFAULT_VAULT_SORT_MODE: VaultSortMode = 'name_asc';

const STORAGE_KEY_PREFIX = 'vault.sort';

const collator = new Intl.Collator(undefined, {
  sensitivity: 'base',
  numeric: true,
});

function safeTrim(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function dataCardNameKey(card: Pick<DataCardSummary, 'title' | 'url' | 'email'>): string {
  const title = safeTrim(card.title);
  if (title.length > 0) return title;

  const url = safeTrim(card.url);
  if (url.length > 0) return url;

  const email = safeTrim(card.email);
  if (email.length > 0) return email;

  return '';
}

function bankCardNameKey(card: Pick<BankCardSummary, 'title'>): string {
  return safeTrim(card.title);
}

function getStorageKey(kind: VaultSortKind, profileId: string): string {
  return `${STORAGE_KEY_PREFIX}.${kind}.${profileId}`;
}

export function getVaultSortMode(kind: VaultSortKind, profileId: string): VaultSortMode {
  if (typeof window === 'undefined') return DEFAULT_VAULT_SORT_MODE;

  try {
    const raw = window.localStorage.getItem(getStorageKey(kind, profileId));
    if (!raw) return DEFAULT_VAULT_SORT_MODE;

    const value = raw as VaultSortMode;
    switch (value) {
      case 'name_asc':
      case 'name_desc':
      case 'updated_desc':
      case 'updated_asc':
      case 'created_desc':
      case 'created_asc':
        return value;
      default:
        return DEFAULT_VAULT_SORT_MODE;
    }
  } catch {
    return DEFAULT_VAULT_SORT_MODE;
  }
}

export function setVaultSortMode(kind: VaultSortKind, profileId: string, mode: VaultSortMode): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(getStorageKey(kind, profileId), mode);
  } catch {
    // Best effort.
  }
}

function parseDateMs(value: string | null | undefined): number {
  const ms = Date.parse(value ?? '');
  return Number.isFinite(ms) ? ms : 0;
}

function compareNameAsc(aKey: string, bKey: string): number {
  const aEmpty = aKey.length === 0;
  const bEmpty = bKey.length === 0;

  // Always keep "empty" names at the end.
  if (aEmpty && !bEmpty) return 1;
  if (!aEmpty && bEmpty) return -1;

  return collator.compare(aKey, bKey);
}

function compareNameDesc(aKey: string, bKey: string): number {
  const aEmpty = aKey.length === 0;
  const bEmpty = bKey.length === 0;

  // Always keep "empty" names at the end.
  if (aEmpty && !bEmpty) return 1;
  if (!aEmpty && bEmpty) return -1;

  return collator.compare(bKey, aKey);
}

export function sortDataCardSummaries(list: DataCardSummary[], mode: VaultSortMode): DataCardSummary[] {
  const withIndex = list.map((card, index) => ({ card, index }));

  const sorted = [...withIndex].sort((a, b) => {
    const aCard = a.card;
    const bCard = b.card;

    const aName = dataCardNameKey(aCard);
    const bName = dataCardNameKey(bCard);

    const aUpdated = parseDateMs(aCard.updatedAt);
    const bUpdated = parseDateMs(bCard.updatedAt);

    const aCreated = parseDateMs(aCard.createdAt);
    const bCreated = parseDateMs(bCard.createdAt);

    let cmp = 0;

    switch (mode) {
      case 'name_asc':
        cmp = compareNameAsc(aName, bName);
        break;
      case 'name_desc':
        cmp = compareNameDesc(aName, bName);
        break;
      case 'updated_desc':
        cmp = bUpdated - aUpdated;
        break;
      case 'updated_asc':
        cmp = aUpdated - bUpdated;
        break;
      case 'created_desc':
        cmp = bCreated - aCreated;
        break;
      case 'created_asc':
        cmp = aCreated - bCreated;
        break;
      default:
        cmp = compareNameAsc(aName, bName);
        break;
    }

    if (cmp !== 0) return cmp;

    // Tie-breakers: name, updated desc, created desc, id, original index.
    const byName = compareNameAsc(aName, bName);
    if (byName !== 0) return byName;

    const byUpdated = bUpdated - aUpdated;
    if (byUpdated !== 0) return byUpdated;

    const byCreated = bCreated - aCreated;
    if (byCreated !== 0) return byCreated;

    const byId = collator.compare(aCard.id, bCard.id);
    if (byId !== 0) return byId;

    return a.index - b.index;
  });

  return sorted.map((x) => x.card);
}

export function sortBankCardSummaries(list: BankCardSummary[], mode: VaultSortMode): BankCardSummary[] {
  const withIndex = list.map((card, index) => ({ card, index }));

  const sorted = [...withIndex].sort((a, b) => {
    const aCard = a.card;
    const bCard = b.card;

    const aName = bankCardNameKey(aCard);
    const bName = bankCardNameKey(bCard);

    const aUpdated = parseDateMs(aCard.updatedAt);
    const bUpdated = parseDateMs(bCard.updatedAt);

    const aCreated = parseDateMs(aCard.createdAt);
    const bCreated = parseDateMs(bCard.createdAt);

    let cmp = 0;

    switch (mode) {
      case 'name_asc':
        cmp = compareNameAsc(aName, bName);
        break;
      case 'name_desc':
        cmp = compareNameDesc(aName, bName);
        break;
      case 'updated_desc':
        cmp = bUpdated - aUpdated;
        break;
      case 'updated_asc':
        cmp = aUpdated - bUpdated;
        break;
      case 'created_desc':
        cmp = bCreated - aCreated;
        break;
      case 'created_asc':
        cmp = aCreated - bCreated;
        break;
      default:
        cmp = compareNameAsc(aName, bName);
        break;
    }

    if (cmp !== 0) return cmp;

    const byName = compareNameAsc(aName, bName);
    if (byName !== 0) return byName;

    const byUpdated = bUpdated - aUpdated;
    if (byUpdated !== 0) return byUpdated;

    const byCreated = bCreated - aCreated;
    if (byCreated !== 0) return byCreated;

    const byId = collator.compare(aCard.id, bCard.id);
    if (byId !== 0) return byId;

    return a.index - b.index;
  });

  return sorted.map((x) => x.card);
}
