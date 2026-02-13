import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Language } from '../../../../../../shared/lib/i18n';

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

type GeneralSectionProps = {
  language: Language;
  onLanguageChange: (language: Language) => void;
  tVault: TranslateFn;
  disabled?: boolean;
};

const LANGUAGE_OPTIONS: Array<{ value: Language; labelKey: string }> = [
  { value: 'en', labelKey: 'settingsModal.general.language.option.en' },
  { value: 'ru', labelKey: 'settingsModal.general.language.option.ru' },
];

export function GeneralSection({ language, onLanguageChange, tVault, disabled = false }: GeneralSectionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = useId();

  const selectedIndex = useMemo(
    () => LANGUAGE_OPTIONS.findIndex((option) => option.value === language),
    [language],
  );

  const selectedLabel = useMemo(() => {
    const option = LANGUAGE_OPTIONS[selectedIndex] ?? LANGUAGE_OPTIONS[0];
    return tVault(option.labelKey);
  }, [selectedIndex, tVault]);

  const focusOption = useCallback((index: number) => {
    if (LANGUAGE_OPTIONS.length === 0) return;
    const normalizedIndex = ((index % LANGUAGE_OPTIONS.length) + LANGUAGE_OPTIONS.length) % LANGUAGE_OPTIONS.length;
    optionRefs.current[normalizedIndex]?.focus();
  }, []);

  const closeMenu = useCallback(() => {
    setIsOpen(false);
  }, []);

  const closeMenuAndFocusTrigger = useCallback(() => {
    setIsOpen(false);
    requestAnimationFrame(() => {
      triggerRef.current?.focus();
    });
  }, []);

  const openMenu = useCallback(() => {
    if (disabled) return;
    setIsOpen(true);
  }, [disabled]);

  const handleSelect = useCallback(
    (nextLanguage: Language) => {
      onLanguageChange(nextLanguage);
      closeMenuAndFocusTrigger();
    },
    [closeMenuAndFocusTrigger, onLanguageChange],
  );

  const handleTriggerKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (disabled) return;

      switch (event.key) {
        case 'ArrowDown':
        case 'ArrowUp':
        case 'Enter':
        case ' ': {
          event.preventDefault();
          setIsOpen(true);
          break;
        }
        default:
          break;
      }
    },
    [disabled],
  );

  const handleMenuKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const currentIndex = optionRefs.current.findIndex((option) => option === document.activeElement);

      switch (event.key) {
        case 'Escape': {
          event.preventDefault();
          closeMenuAndFocusTrigger();
          break;
        }
        case 'ArrowDown': {
          event.preventDefault();
          focusOption(currentIndex < 0 ? 0 : currentIndex + 1);
          break;
        }
        case 'ArrowUp': {
          event.preventDefault();
          focusOption(currentIndex < 0 ? LANGUAGE_OPTIONS.length - 1 : currentIndex - 1);
          break;
        }
        case 'Home': {
          event.preventDefault();
          focusOption(0);
          break;
        }
        case 'End': {
          event.preventDefault();
          focusOption(LANGUAGE_OPTIONS.length - 1);
          break;
        }
        case 'Tab': {
          closeMenu();
          break;
        }
        default:
          break;
      }
    },
    [closeMenu, closeMenuAndFocusTrigger, focusOption],
  );

  useEffect(() => {
    if (!isOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (!dropdownRef.current?.contains(target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const indexToFocus = selectedIndex >= 0 ? selectedIndex : 0;
    requestAnimationFrame(() => {
      focusOption(indexToFocus);
    });
  }, [focusOption, isOpen, selectedIndex]);

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
            <div ref={dropdownRef} className="settings-language-dropdown">
              <button
                ref={triggerRef}
                id="language-select-trigger"
                type="button"
                className="settings-language-dropdown__trigger"
                aria-labelledby="language-label language-select-trigger"
                aria-haspopup="listbox"
                aria-controls={listboxId}
                aria-expanded={isOpen}
                data-open={isOpen ? 'true' : 'false'}
                disabled={disabled}
                onClick={() => {
                  if (disabled) return;
                  setIsOpen((value) => !value);
                }}
                onKeyDown={handleTriggerKeyDown}
              >
                <span className="settings-language-dropdown__value">{selectedLabel}</span>
                <span className="settings-language-dropdown__chevron" aria-hidden="true">
                  ▾
                </span>
              </button>

              {isOpen && (
                <div
                  id={listboxId}
                  role="listbox"
                  aria-labelledby="language-label"
                  className="settings-language-dropdown__menu"
                  onKeyDown={handleMenuKeyDown}
                >
                  {LANGUAGE_OPTIONS.map((option, index) => {
                    const isSelected = option.value === language;
                    return (
                      <button
                        key={option.value}
                        ref={(element) => {
                          optionRefs.current[index] = element;
                        }}
                        id={`${listboxId}-${option.value}`}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        className="settings-language-dropdown__item"
                        data-selected={isSelected ? 'true' : 'false'}
                        onClick={() => handleSelect(option.value)}
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
