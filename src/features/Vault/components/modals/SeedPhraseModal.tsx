import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '../../../../shared/lib/i18n';

type WordCount = 12 | 18 | 24;

type SeedPhraseModalProps = {
  isOpen: boolean;
  existingPhrase: string | null;
  onCancel: () => void;
  onSave: (words: string[], wordCount: WordCount) => void;
};

const WORD_COUNTS: WordCount[] = [12, 18, 24];

const splitWords = (value: string) =>
  value
    .trim()
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);

export const SeedPhraseModal: React.FC<SeedPhraseModalProps> = ({
  isOpen,
  existingPhrase,
  onCancel,
  onSave,
}) => {
  const { t } = useTranslation('DataCards');
  const existingWords = useMemo(() => (existingPhrase ? splitWords(existingPhrase) : []), [existingPhrase]);

  const [wordCount, setWordCount] = useState<WordCount>(12);
  const [words, setWords] = useState<string[]>(Array.from({ length: 12 }, () => ''));
  const [error, setError] = useState<string | null>(null);
  const [isCountMenuOpen, setIsCountMenuOpen] = useState(false);
  const countButtonRef = useRef<HTMLButtonElement | null>(null);
  const countMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const inferred = (WORD_COUNTS.includes(existingWords.length as WordCount)
      ? (existingWords.length as WordCount)
      : 12) as WordCount;

    setWordCount(inferred);
    setWords((prev) => {
      const next = Array.from({ length: inferred }, (_, i) => existingWords[i] ?? '');
      return next.length ? next : prev;
    });
    setError(null);
    setIsCountMenuOpen(false);
  }, [existingWords, isOpen]);

  const handleChangeCount = (next: WordCount) => {
    setWordCount(next);
    setWords((prev) => {
      const trimmed = prev.slice(0, next);
      const padded = [...trimmed, ...Array.from({ length: Math.max(0, next - trimmed.length) }, () => '')];
      return padded;
    });
    setError(null);
  };

  useEffect(() => {
    if (!isOpen || !isCountMenuOpen) return;

    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (countMenuRef.current?.contains(target)) return;
      if (countButtonRef.current?.contains(target)) return;
      setIsCountMenuOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsCountMenuOpen(false);
    };

    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isCountMenuOpen, isOpen]);

  const handleChangeWord = (index: number, value: string) => {
    const tokens = splitWords(value);
    setWords((prev) => {
      const next = [...prev];
      if (tokens.length <= 1) {
        next[index] = value;
        return next;
      }

      for (let i = 0; i < tokens.length; i += 1) {
        const pos = index + i;
        if (pos >= next.length) break;
        next[pos] = tokens[i];
      }
      return next;
    });
    setError(null);
  };

  const handleSave = () => {
    const normalized = words.map((w) => w.trim()).filter((w) => w.length > 0);
    if (normalized.length !== wordCount) {
      setError(t('seedPhrase.errorIncomplete'));
      return;
    }
    onSave(words.map((w) => w.trim()), wordCount);
  };

  if (!isOpen) return null;

  return (
    <div
      className="dialog-backdrop dialog-backdrop--inner"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <div className="dialog seedphrase-dialog" role="dialog" aria-modal="true" aria-labelledby="seedphrase-title">
        <button className="dialog-close dialog-close--topright" type="button" aria-label="Close" onClick={onCancel}>
          {'\u00D7'}
        </button>
        <div className="dialog-header">
          <h2 id="seedphrase-title" className="dialog-title">
            {t('seedPhrase.title')}
          </h2>
        </div>

        <div className="dialog-body">
          <div className="form-field">
            <label className="form-label" htmlFor="seedphrase-count">
              {t('seedPhrase.wordCount')}
            </label>
            <div className="seedphrase-select">
              <button
                ref={countButtonRef}
                id="seedphrase-count"
                type="button"
                className="seedphrase-select__button"
                aria-haspopup="listbox"
                aria-expanded={isCountMenuOpen}
                onClick={() => setIsCountMenuOpen((prev) => !prev)}
              >
                <span>
                  {wordCount === 12
                    ? t('seedPhrase.words12')
                    : wordCount === 18
                      ? t('seedPhrase.words18')
                      : t('seedPhrase.words24')}
                </span>
                <span className="seedphrase-select__chevron" aria-hidden="true">
                  ▾
                </span>
              </button>
              {isCountMenuOpen && (
                <div
                  ref={countMenuRef}
                  className="seedphrase-select__menu"
                  role="listbox"
                  aria-labelledby="seedphrase-count"
                >
                  {WORD_COUNTS.map((count) => (
                    <button
                      key={count}
                      type="button"
                      role="option"
                      aria-selected={count === wordCount}
                      className={`seedphrase-select__option ${count === wordCount ? 'is-selected' : ''}`}
                      onClick={() => {
                        handleChangeCount(count);
                        setIsCountMenuOpen(false);
                      }}
                    >
                      {count === 12
                        ? t('seedPhrase.words12')
                        : count === 18
                          ? t('seedPhrase.words18')
                          : t('seedPhrase.words24')}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="seedphrase-grid" aria-label={t('seedPhrase.gridAria')}>
            {Array.from({ length: wordCount }, (_, i) => (
              <div className="seedphrase-cell" key={`seed-${i}`}>
                <span className="seedphrase-index">{i + 1}.</span>
                <input
                  className="input seedphrase-input"
                  value={words[i] ?? ''}
                  onChange={(e) => handleChangeWord(i, e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            ))}
          </div>

          {error && <div className="form-error">{error}</div>}
        </div>

        <div className="dialog-footer dialog-footer--split">
          <div className="dialog-footer-left">
            <button className="btn btn-secondary" type="button" onClick={onCancel}>
              {t('action.cancel')}
            </button>
          </div>
          <div className="dialog-footer-right">
            <button className="btn btn-primary" type="button" onClick={handleSave}>
              {t('action.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
