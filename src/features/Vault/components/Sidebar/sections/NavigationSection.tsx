import React from 'react';
import { useTranslation } from '../../../../../shared/lib/i18n';
import type { SelectedNav } from '../../../hooks/useVault';
import type { SidebarCounts, VaultCategory } from '../sidebarTypes';

type NavigationSectionProps = {
  selectedNav: SelectedNav;
  selectedCategory: VaultCategory;
  counts: SidebarCounts;
  onSelectNav: (nav: SelectedNav) => void;
};

export function NavigationSection({
  selectedNav,
  selectedCategory,
  counts,
  onSelectNav,
}: NavigationSectionProps) {
  const { t } = useTranslation('Folders');

  const renderSystemItem = (
    key: SelectedNav,
    label: string,
    count: number,
    isActive: boolean
  ) => (
    <li className={isActive ? 'active' : ''}>
      <button className="vault-folder" type="button" onClick={() => onSelectNav(key)}>
        <span className="folder-name">{label}</span>
        <span className="folder-count">{count}</span>
      </button>
    </li>
  );

  return (
    <>
      <div className="vault-sidebar-title">{t('nav.title')}</div>
      <ul className="vault-folder-list">
        {renderSystemItem(
          'all',
          t('nav.allItems'),
          counts.all,
          selectedNav === 'all' && selectedCategory === 'all_items'
        )}
        {renderSystemItem(
          'favorites',
          t('nav.favorites'),
          counts.favorites,
          selectedNav === 'favorites' && selectedCategory === 'all_items'
        )}
        {renderSystemItem(
          'archive',
          t('nav.archive'),
          counts.archive,
          selectedNav === 'archive' && selectedCategory === 'all_items'
        )}
        {renderSystemItem(
          'deleted',
          t('nav.deleted'),
          counts.deleted,
          selectedNav === 'deleted' && selectedCategory === 'all_items'
        )}
      </ul>
    </>
  );
}
