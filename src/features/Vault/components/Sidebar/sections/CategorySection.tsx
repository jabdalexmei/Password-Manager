import React from 'react';
import { useTranslation } from '../../../../../shared/lib/i18n';
import type { SidebarCounts, SidebarMenu, VaultCategory } from '../sidebarTypes';

type CategorySectionProps = {
  selectedCategory: VaultCategory;
  onSelectCategory: (category: VaultCategory) => void;
  counts: SidebarCounts;
  categoryCounts?: { dataCards: number; bankCards: number };
  onAddBankCard: () => void;
  openMenu: SidebarMenu;
  setOpenMenu: (menu: SidebarMenu) => void;
};

export function CategorySection({
  selectedCategory,
  onSelectCategory,
  counts,
  categoryCounts,
  onAddBankCard,
  openMenu,
  setOpenMenu,
}: CategorySectionProps) {
  const { t } = useTranslation('Folders');

  return (
    <>
      <div className="vault-sidebar-title">{t('category.title')}</div>
      <ul className="vault-folder-list">
        {categoryCounts && (
          <li className={selectedCategory === 'data_cards' ? 'active' : ''}>
            <button className="vault-folder" type="button" onClick={() => onSelectCategory('data_cards')}>
              <span className="folder-name">{t('category.dataCards')}</span>
              <span className="folder-count">{categoryCounts.dataCards}</span>
            </button>
          </li>
        )}
        <li className={selectedCategory === 'bank_cards' ? 'active' : ''}>
          <button
            className="vault-folder"
            type="button"
            onClick={() => onSelectCategory('bank_cards')}
            onContextMenu={(event) => {
              event.preventDefault();
              setOpenMenu({ type: 'category', x: event.clientX, y: event.clientY });
            }}
          >
            <span className="folder-name">{t('category.bankCards')}</span>
            <span className="folder-count">{categoryCounts?.bankCards ?? counts.all}</span>
          </button>
        </li>
      </ul>

      {openMenu && openMenu.type === 'category' && (
        <div
          className="vault-context-backdrop"
          onClick={() => setOpenMenu(null)}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div
            className="vault-context-menu"
            role="menu"
            style={{ top: openMenu.y, left: openMenu.x }}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="vault-context-item"
              onClick={() => {
                onAddBankCard();
                setOpenMenu(null);
              }}
            >
              {t('action.addBankCard')}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
