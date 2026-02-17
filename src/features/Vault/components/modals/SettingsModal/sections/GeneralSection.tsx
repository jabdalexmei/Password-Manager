import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Language } from '../../../../../../shared/lib/i18n';
import type { BackendDateTimeFormat } from '../../../../types/backend';

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

type GeneralSectionProps = {
  language: Language;
  dateTimeFormat: BackendDateTimeFormat;
  onLanguageChange: (language: Language) => void;
  onDateTimeFormatChange: (format: BackendDateTimeFormat) => void;
  tVault: TranslateFn;
  disabled?: boolean;
};

const LANGUAGE_OPTIONS: Array<{ value: Language; labelKey: string }> = [
  { value: 'en', labelKey: 'settingsModal.general.language.option.en' },
  { value: 'ru', labelKey: 'settingsModal.general.language.option.ru' },
];

const DATE_TIME_FORMAT_OPTIONS: Array<{ value: BackendDateTimeFormat; labelKey: string }> = [
  { value: 'auto', labelKey: 'settingsModal.general.dateTimeFormat.option.auto' },
  { value: 'ddmmyyyy_24h', labelKey: 'settingsModal.general.dateTimeFormat.option.ddmmyyyy_24h' },
  { value: 'mmddyyyy_12h_ampm', labelKey: 'settingsModal.general.dateTimeFormat.option.mmddyyyy_12h_ampm' },
];

export function GeneralSection({
  language,
  dateTimeFormat,
  onLanguageChange,
  onDateTimeFormatChange,
  tVault,
  disabled = false,
}: GeneralSectionProps) {
  const [isLanguageOpen, setIsLanguageOpen] = useState(false);
  const [isDateTimeOpen, setIsDateTimeOpen] = useState(false);

  const languageDropdownRef = useRef<HTMLDivElement | null>(null);
  const languageTriggerRef = useRef<HTMLButtonElement | null>(null);
  const languageOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const dateTimeDropdownRef = useRef<HTMLDivElement | null>(null);
  const dateTimeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const dateTimeOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const languageListboxId = useId();
  const dateTimeListboxId = useId();

  const selectedLanguageIndex = useMemo(
    () => LANGUAGE_OPTIONS.findIndex((option) => option.value === language),
    [language],
  );

  const selectedDateTimeFormatIndex = useMemo(
    () => DATE_TIME_FORMAT_OPTIONS.findIndex((option) => option.value === dateTimeFormat),
    [dateTimeFormat],
  );

  const selectedLanguageLabel = useMemo(() => {
    const option = LANGUAGE_OPTIONS[selectedLanguageIndex] ?? LANGUAGE_OPTIONS[0];
    return tVault(option.labelKey);
  }, [selectedLanguageIndex, tVault]);

  const selectedDateTimeFormatLabel = useMemo(() => {
    const option = DATE_TIME_FORMAT_OPTIONS[selectedDateTimeFormatIndex] ?? DATE_TIME_FORMAT_OPTIONS[0];
    return tVault(option.labelKey);
  }, [selectedDateTimeFormatIndex, tVault]);

  const focusLanguageOption = useCallback((index: number) => {
    if (LANGUAGE_OPTIONS.length === 0) return;
    const normalizedIndex = ((index % LANGUAGE_OPTIONS.length) + LANGUAGE_OPTIONS.length) % LANGUAGE_OPTIONS.length;
    languageOptionRefs.current[normalizedIndex]?.focus();
  }, []);

  const focusDateTimeOption = useCallback((index: number) => {
    if (DATE_TIME_FORMAT_OPTIONS.length === 0) return;
    const normalizedIndex =
      ((index % DATE_TIME_FORMAT_OPTIONS.length) + DATE_TIME_FORMAT_OPTIONS.length) % DATE_TIME_FORMAT_OPTIONS.length;
    dateTimeOptionRefs.current[normalizedIndex]?.focus();
  }, []);

  const closeLanguageMenu = useCallback(() => {
    setIsLanguageOpen(false);
  }, []);

  const closeDateTimeMenu = useCallback(() => {
    setIsDateTimeOpen(false);
  }, []);

  const closeLanguageMenuAndFocusTrigger = useCallback(() => {
    setIsLanguageOpen(false);
    requestAnimationFrame(() => {
      languageTriggerRef.current?.focus();
    });
  }, []);

  const closeDateTimeMenuAndFocusTrigger = useCallback(() => {
    setIsDateTimeOpen(false);
    requestAnimationFrame(() => {
      dateTimeTriggerRef.current?.focus();
    });
  }, []);

  const handleLanguageSelect = useCallback(
    (nextLanguage: Language) => {
      onLanguageChange(nextLanguage);
      closeLanguageMenuAndFocusTrigger();
    },
    [closeLanguageMenuAndFocusTrigger, onLanguageChange],
  );

  const handleDateTimeFormatSelect = useCallback(
    (nextFormat: BackendDateTimeFormat) => {
      onDateTimeFormatChange(nextFormat);
      closeDateTimeMenuAndFocusTrigger();
    },
    [closeDateTimeMenuAndFocusTrigger, onDateTimeFormatChange],
  );

  const handleLanguageTriggerKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (disabled) return;

      switch (event.key) {
        case 'ArrowDown':
        case 'ArrowUp':
        case 'Enter':
        case ' ': {
          event.preventDefault();
          setIsDateTimeOpen(false);
          setIsLanguageOpen(true);
          break;
        }
        default:
          break;
      }
    },
    [disabled],
  );

  const handleDateTimeTriggerKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (disabled) return;

      switch (event.key) {
        case 'ArrowDown':
        case 'ArrowUp':
        case 'Enter':
        case ' ': {
          event.preventDefault();
          setIsLanguageOpen(false);
          setIsDateTimeOpen(true);
          break;
        }
        default:
          break;
      }
    },
    [disabled],
  );

  const handleLanguageMenuKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const currentIndex = languageOptionRefs.current.findIndex((option) => option === document.activeElement);

      switch (event.key) {
        case 'Escape': {
          event.preventDefault();
          closeLanguageMenuAndFocusTrigger();
          break;
        }
        case 'ArrowDown': {
          event.preventDefault();
          focusLanguageOption(currentIndex < 0 ? 0 : currentIndex + 1);
          break;
        }
        case 'ArrowUp': {
          event.preventDefault();
          focusLanguageOption(currentIndex < 0 ? LANGUAGE_OPTIONS.length - 1 : currentIndex - 1);
          break;
        }
        case 'Home': {
          event.preventDefault();
          focusLanguageOption(0);
          break;
        }
        case 'End': {
          event.preventDefault();
          focusLanguageOption(LANGUAGE_OPTIONS.length - 1);
          break;
        }
        case 'Tab': {
          closeLanguageMenu();
          break;
        }
        default:
          break;
      }
    },
    [closeLanguageMenu, closeLanguageMenuAndFocusTrigger, focusLanguageOption],
  );

  const handleDateTimeMenuKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const currentIndex = dateTimeOptionRefs.current.findIndex((option) => option === document.activeElement);

      switch (event.key) {
        case 'Escape': {
          event.preventDefault();
          closeDateTimeMenuAndFocusTrigger();
          break;
        }
        case 'ArrowDown': {
          event.preventDefault();
          focusDateTimeOption(currentIndex < 0 ? 0 : currentIndex + 1);
          break;
        }
        case 'ArrowUp': {
          event.preventDefault();
          focusDateTimeOption(currentIndex < 0 ? DATE_TIME_FORMAT_OPTIONS.length - 1 : currentIndex - 1);
          break;
        }
        case 'Home': {
          event.preventDefault();
          focusDateTimeOption(0);
          break;
        }
        case 'End': {
          event.preventDefault();
          focusDateTimeOption(DATE_TIME_FORMAT_OPTIONS.length - 1);
          break;
        }
        case 'Tab': {
          closeDateTimeMenu();
          break;
        }
        default:
          break;
      }
    },
    [closeDateTimeMenu, closeDateTimeMenuAndFocusTrigger, focusDateTimeOption],
  );

  useEffect(() => {
    if (!isLanguageOpen && !isDateTimeOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;

      if (!languageDropdownRef.current?.contains(target) && !dateTimeDropdownRef.current?.contains(target)) {
        setIsLanguageOpen(false);
        setIsDateTimeOpen(false);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [isDateTimeOpen, isLanguageOpen]);

  useEffect(() => {
    if (!isLanguageOpen) return;

    const indexToFocus = selectedLanguageIndex >= 0 ? selectedLanguageIndex : 0;
    requestAnimationFrame(() => {
      focusLanguageOption(indexToFocus);
    });
  }, [focusLanguageOption, isLanguageOpen, selectedLanguageIndex]);

  useEffect(() => {
    if (!isDateTimeOpen) return;

    const indexToFocus = selectedDateTimeFormatIndex >= 0 ? selectedDateTimeFormatIndex : 0;
    requestAnimationFrame(() => {
      focusDateTimeOption(indexToFocus);
    });
  }, [focusDateTimeOption, isDateTimeOpen, selectedDateTimeFormatIndex]);

  return (
    <>
      <h3 id="general-title" className="settings-modal-section-title">
        {tVault('settingsModal.generalTitle')}
      </h3>

      <div role="group" aria-labelledby="general-title" className="settings-group">
        <div className="form-field settings-toggle-row settings-language-row">
          <div>
            <div className="form-label settings-subheader" id="language-label">
              {tVault('settingsModal.general.language.title')}
            </div>
            <div className="form-label">{tVault('settingsModal.general.language.description')}</div>
          </div>

          <div className="settings-toggle-row__control">
            <div ref={languageDropdownRef} className="settings-language-dropdown">
              <button
                ref={languageTriggerRef}
                id="language-select-trigger"
                type="button"
                className="settings-language-dropdown__trigger"
                aria-labelledby="language-label language-select-trigger"
                aria-haspopup="listbox"
                aria-controls={languageListboxId}
                aria-expanded={isLanguageOpen}
                data-open={isLanguageOpen ? 'true' : 'false'}
                disabled={disabled}
                onClick={() => {
                  if (disabled) return;
                  setIsDateTimeOpen(false);
                  setIsLanguageOpen((value) => !value);
                }}
                onKeyDown={handleLanguageTriggerKeyDown}
              >
                <span className="settings-language-dropdown__value">{selectedLanguageLabel}</span>
                <span className="settings-language-dropdown__chevron" aria-hidden="true">
                  ▾
                </span>
              </button>

              {isLanguageOpen && (
                <div
                  id={languageListboxId}
                  role="listbox"
                  aria-labelledby="language-label"
                  className="settings-language-dropdown__menu"
                  onKeyDown={handleLanguageMenuKeyDown}
                >
                  {LANGUAGE_OPTIONS.map((option, index) => {
                    const isSelected = option.value === language;
                    return (
                      <button
                        key={option.value}
                        ref={(element) => {
                          languageOptionRefs.current[index] = element;
                        }}
                        id={`${languageListboxId}-${option.value}`}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        className="settings-language-dropdown__item"
                        data-selected={isSelected ? 'true' : 'false'}
                        onClick={() => handleLanguageSelect(option.value)}
                      >
                        {tVault(option.labelKey)}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="form-field settings-toggle-row settings-date-time-row">
          <div>
            <div className="form-label settings-subheader" id="date-time-format-label">
              {tVault('settingsModal.general.dateTimeFormat.title')}
            </div>
            <div className="form-label">{tVault('settingsModal.general.dateTimeFormat.description')}</div>
          </div>

          <div className="settings-toggle-row__control">
            <div ref={dateTimeDropdownRef} className="settings-language-dropdown settings-date-time-dropdown">
              <button
                ref={dateTimeTriggerRef}
                id="date-time-format-select-trigger"
                type="button"
                className="settings-language-dropdown__trigger"
                aria-labelledby="date-time-format-label date-time-format-select-trigger"
                aria-haspopup="listbox"
                aria-controls={dateTimeListboxId}
                aria-expanded={isDateTimeOpen}
                data-open={isDateTimeOpen ? 'true' : 'false'}
                disabled={disabled}
                onClick={() => {
                  if (disabled) return;
                  setIsLanguageOpen(false);
                  setIsDateTimeOpen((value) => !value);
                }}
                onKeyDown={handleDateTimeTriggerKeyDown}
              >
                <span className="settings-language-dropdown__value">{selectedDateTimeFormatLabel}</span>
                <span className="settings-language-dropdown__chevron" aria-hidden="true">
                  ▾
                </span>
              </button>

              {isDateTimeOpen && (
                <div
                  id={dateTimeListboxId}
                  role="listbox"
                  aria-labelledby="date-time-format-label"
                  className="settings-language-dropdown__menu"
                  onKeyDown={handleDateTimeMenuKeyDown}
                >
                  {DATE_TIME_FORMAT_OPTIONS.map((option, index) => {
                    const isSelected = option.value === dateTimeFormat;
                    return (
                      <button
                        key={option.value}
                        ref={(element) => {
                          dateTimeOptionRefs.current[index] = element;
                        }}
                        id={`${dateTimeListboxId}-${option.value}`}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        className="settings-language-dropdown__item"
                        data-selected={isSelected ? 'true' : 'false'}
                        onClick={() => handleDateTimeFormatSelect(option.value)}
                      >
                        {tVault(option.labelKey)}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
