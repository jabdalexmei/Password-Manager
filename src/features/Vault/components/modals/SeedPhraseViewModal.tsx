import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from '../../../../shared/lib/i18n';
import { IconPreview, IconPreviewOff } from '@/shared/icons/lucide/icons';

type WordCount = 12 | 18 | 24;

type SeedPhraseViewModalProps = {
  isOpen: boolean;
  phrase: string | null;
  wordCount: WordCount | null;
  onClose: () => void;
};

const splitWords = (value: string) =>
  value
    .trim()
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);

const inferWordCount = (len: number): WordCount => {
  if (len === 18) return 18;
  if (len === 24) return 24;
  return 12;
};

export const SeedPhraseViewModal: React.FC<SeedPhraseViewModalProps> = ({
  isOpen,
  phrase,
  wordCount,
  onClose,
}) => {
  const { t } = useTranslation('Details');
  const { t: tCommon } = useTranslation('Common');

  const words = useMemo(() => (phrase ? splitWords(phrase) : []), [phrase]);
  const resolvedCount = useMemo<WordCount>(() => {
    if (wordCount === 12 || wordCount === 18 || wordCount === 24) return wordCount;
    return inferWordCount(words.length);
  }, [wordCount, words.length]);

  const gridWords = useMemo(
    () => Array.from({ length: resolvedCount }, (_, i) => words[i] ?? ''),
    [resolvedCount, words]
  );

  const [isRevealed, setIsRevealed] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setIsRevealed(false);
  }, [isOpen]);

  if (!isOpen) return null;

  const toggleLabel = isRevealed ? t('seedPhrase.hide') : t('seedPhrase.reveal');

  return (
    <div
      className="dialog-backdrop dialog-backdrop--inner"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="dialog seedphrase-dialog seedphrase-view-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="seedphrase-view-title"
      >
        <button
          className="dialog-close dialog-close--topright"
          type="button"
          aria-label={tCommon('action.close')}
          onClick={onClose}
        >
          {'\u00D7'}
        </button>
        <div className="dialog-header">
          <h2 id="seedphrase-view-title" className="dialog-title">
            {t('seedPhrase.title')}
          </h2>
        </div>

        <div className="dialog-body">
          <div className="seedphrase-grid seedphrase-grid--readonly" aria-label={t('seedPhrase.gridAria')}>
            {gridWords.map((word, i) => (
              <div className="seedphrase-cell" key={`seed-view-${i}`}>
                <span className="seedphrase-index">{i + 1}.</span>
                <div className="seedphrase-wordbox" aria-label={t('seedPhrase.wordAria', { index: i + 1 })}>
                  {isRevealed ? word : '••••'}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="dialog-footer dialog-footer--split">
          <div className="dialog-footer-left">
            <button className="btn btn-secondary" type="button" onClick={onClose}>
              {t('action.back')}
            </button>
          </div>

          <div className="dialog-footer-right seedphrase-view-footer">
            <button
              className="btn btn-secondary btn-compact"
              type="button"
              aria-pressed={isRevealed}
              onClick={() => setIsRevealed((prev) => !prev)}
            >
              {isRevealed ? <IconPreviewOff /> : <IconPreview />}
              {toggleLabel}
            </button>

            <button className="btn btn-primary" type="button" onClick={onClose}>
              {tCommon('action.ok')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
