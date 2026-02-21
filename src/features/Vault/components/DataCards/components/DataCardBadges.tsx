import React from 'react';

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

type DataCardBadgesProps = {
  isFavorite: boolean;
  hasAttachments: boolean;
  hasSeedPhrase: boolean;
  hasTotp: boolean;
  t: TranslateFn;
};

export function DataCardBadges({ isFavorite, hasAttachments, hasSeedPhrase, hasTotp, t }: DataCardBadgesProps) {
  if (!(hasTotp || hasSeedPhrase || hasAttachments || isFavorite)) return null;

  return (
    <div className="datacard-badges">
      {isFavorite && <span className="pill datacard-favorite">{t('label.favorite')}</span>}
      {hasAttachments && <span className="pill">{t('attachments.pill')}</span>}
      {hasSeedPhrase && <span className="pill">{t('seedPhrase.title')}</span>}
      {hasTotp && <span className="pill">{t('twoFactor.pill')}</span>}
    </div>
  );
}
