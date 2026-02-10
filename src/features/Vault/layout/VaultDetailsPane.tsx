import React, { Suspense } from 'react';
import { BankCardDetails } from '../components/BankCards/BankCardDetails';

const LazyDetails = React.lazy(() =>
  import('../components/Details/Details').then((m) => ({ default: m.Details }))
);

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

type VaultDetailsPaneProps = {
  activeDetailsKind: 'data' | 'bank';
  bankCards: any;
  bankCardsViewModel: any;
  vault: any;
  dataCardsViewModel: any;
  foldersForCards: any[];
  tCommon: TranslateFn;
  tVault: TranslateFn;
  tDetails: TranslateFn;
};

export function VaultDetailsPane({
  activeDetailsKind,
  bankCards,
  bankCardsViewModel,
  vault,
  dataCardsViewModel,
  foldersForCards,
  tCommon,
  tVault,
  tDetails,
}: VaultDetailsPaneProps) {
  if (activeDetailsKind === 'bank') {
    return (
      <BankCardDetails
        card={bankCards.selectedCard}
        onEdit={(card) => bankCardsViewModel.openEditModal(card)}
        onDelete={bankCards.deleteCard}
        onRestore={bankCards.restoreCard}
        onPurge={bankCards.purgeCard}
        onToggleFavorite={bankCards.toggleFavorite}
        isTrashMode={bankCards.isTrashMode}
        clipboardAutoClearEnabled={bankCards.settings?.clipboard_auto_clear_enabled}
        clipboardClearTimeoutSeconds={bankCards.settings?.clipboard_clear_timeout_seconds}
      />
    );
  }

  if (vault.selectedCard) {
    return (
      <Suspense fallback={<p aria-busy="true">{tCommon('label.loading')}</p>}>
        <LazyDetails
          card={vault.selectedCard}
          folders={foldersForCards}
          activeFolderId={vault.selectedFolderId}
          onAttachmentPresenceChange={vault.setCardHasAttachments}
          onEdit={(card) => dataCardsViewModel.openEditModal(card)}
          onDelete={vault.deleteCard}
          onRestore={vault.restoreCard}
          onPurge={vault.purgeCard}
          onToggleFavorite={vault.toggleFavorite}
          onReloadCard={vault.loadCard}
          isTrashMode={vault.isTrashMode}
          clipboardAutoClearEnabled={vault.settings?.clipboard_auto_clear_enabled}
          clipboardClearTimeoutSeconds={vault.settings?.clipboard_clear_timeout_seconds}
        />
      </Suspense>
    );
  }

  return (
    <div className="vault-panel-wrapper">
      <div className="vault-section-header">{tVault('information.title')}</div>
      <div className="vault-empty">{tDetails('empty.selectPrompt')}</div>
    </div>
  );
}
