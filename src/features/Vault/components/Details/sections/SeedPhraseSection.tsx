import React from 'react';

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

type SeedPhraseSectionProps = {
  seedPhraseWordCount: number;
  onOpen: () => void;
  t: TranslateFn;
};

export function SeedPhraseSection({ seedPhraseWordCount, onOpen, t }: SeedPhraseSectionProps) {
  if (seedPhraseWordCount <= 0) return null;

  return (
    <div className="detail-field">
      <div className="detail-label">{t('label.seedPhrase')}</div>
      <div className="detail-value-box">
        <div className="detail-value-text">{t('seedPhrase.wordsCount', { count: seedPhraseWordCount })}</div>
        <div className="detail-value-actions">
          <button className="btn btn-secondary btn-compact" type="button" onClick={onOpen}>
            {t('action.open')}
          </button>
        </div>
      </div>
    </div>
  );
}
