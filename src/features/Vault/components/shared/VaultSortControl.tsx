import React, { useMemo, useState } from 'react';
import { useTranslation } from '@/shared/lib/i18n';
import { IconCheck, IconSort } from '@/shared/icons/lucide/icons';
import type { VaultSortMode } from '../../lib/vaultSort';

type SortOption = {
  value: VaultSortMode;
  label: string;
};

export type VaultSortControlProps = {
  value: VaultSortMode;
  onChange: (mode: VaultSortMode) => void;
  disabled?: boolean;
};

export function VaultSortControl({ value, onChange, disabled }: VaultSortControlProps) {
  const { t } = useTranslation('Common');
  const [open, setOpen] = useState(false);

  const options = useMemo<SortOption[]>(
    () => [
      { value: 'name_asc', label: t('sort.nameAsc') },
      { value: 'name_desc', label: t('sort.nameDesc') },
      // Divider
      { value: 'updated_desc', label: t('sort.updatedDesc') },
      { value: 'updated_asc', label: t('sort.updatedAsc') },
      // Divider
      { value: 'created_desc', label: t('sort.createdDesc') },
      { value: 'created_asc', label: t('sort.createdAsc') },
    ],
    [t]
  );

  const isDividerIndex = (idx: number) => idx === 2 || idx === 4;

  return (
    <div className="datacards-actions vault-sortmenu">
      <button
        className="btn btn-icon vault-actionbar"
        type="button"
        aria-label={t('sort.aria.open')}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
      >
        <IconSort className="vault-actionbar-icon" size={18} />
      </button>

      {open && (
        <>
          <div className="vault-actionmenu-backdrop" onClick={() => setOpen(false)} />
          <div className="vault-sortmenu-panel vault-context-menu" role="menu">
            {options.map((opt, idx) => (
              <React.Fragment key={opt.value}>
                {isDividerIndex(idx) && <div className="vault-sortmenu-divider" role="separator" />}
                <button
                  className="vault-context-item vault-sortmenu-item"
                  type="button"
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                >
                  <span className="vault-sortmenu-label">{opt.label}</span>
                  {value === opt.value ? (
                    <IconCheck className="vault-sortmenu-check" size={16} />
                  ) : (
                    <span className="vault-sortmenu-check-spacer" aria-hidden="true" />
                  )}
                </button>
              </React.Fragment>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
