import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from '../../../../shared/lib/i18n';
import { IconFilter } from '../../../../shared/icons/lucide/icons';
import type { VaultFilters } from '../../hooks/useVault';

type Props = {
  query: string;
  onChange: (value: string) => void;
  filters?: VaultFilters;
  onChangeFilters?: (next: VaultFilters) => void;
};

const FILTER_ORDER: Array<{ key: keyof VaultFilters; labelKey: string }> = [
  { key: 'totp', labelKey: 'filters.2fa' },
  { key: 'seedPhrase', labelKey: 'filters.seedPhrase' },
  { key: 'recoveryEmail', labelKey: 'filters.recoveryEmail' },
  { key: 'phone', labelKey: 'filters.phone' },
  { key: 'notes', labelKey: 'filters.notes' },
  { key: 'attachments', labelKey: 'filters.attachments' },
];

export function Search({ query, onChange, filters, onChangeFilters }: Props) {
  const { t } = useTranslation('Vault');
  const [isOpen, setIsOpen] = useState(false);

  const hasFiltersUi = Boolean(filters && onChangeFilters);

  const close = useCallback(() => setIsOpen(false), []);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [close, isOpen]);

  return (
    <div className="vault-search-wrapper">
      <div className="vault-search-row">
        <input
          type="search"
          className="vault-search"
          placeholder={t('search.placeholder')}
          value={query}
          onChange={(e) => onChange(e.target.value)}
        />
        {hasFiltersUi && (
          <button
            type="button"
            className="vault-filter-btn"
            aria-label={t('filters.title')}
            aria-expanded={isOpen}
            onClick={() => setIsOpen((v) => !v)}
          >
            <IconFilter size={18} />
          </button>
        )}
      </div>

      {hasFiltersUi && isOpen && (
        <>
          <div className="vault-filter-backdrop" onClick={close} />
          <div className="vault-filter-panel" role="dialog" aria-label={t('filters.title')}>
            <div className="vault-filter-panel__title">{t('filters.title')}</div>
            <div className="vault-filter-list" aria-label={t('filters.title')}>
              {FILTER_ORDER.map(({ key, labelKey }) => {
                const active = Boolean(filters?.[key]);
                return (
                  <button
                    key={key}
                    type="button"
                    className={`filter-chip${active ? ' is-active' : ''}`}
                    aria-pressed={active}
                    onClick={() => {
                      if (!filters || !onChangeFilters) return;
                      onChangeFilters({ ...filters, [key]: !filters[key] });
                    }}
                  >
                    {t(labelKey)}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
