import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

type ThemeOption = 'blueTheme' | 'darkTheme';

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

type AppearanceSectionProps = {
  theme: ThemeOption;
  onThemeChange: (theme: ThemeOption) => void;
  tVault: TranslateFn;
  disabled?: boolean;
};

const THEME_OPTIONS: Array<{ value: ThemeOption; labelKey: string }> = [
  { value: 'blueTheme', labelKey: 'settingsModal.appearance.themes.option.blue' },
  { value: 'darkTheme', labelKey: 'settingsModal.appearance.themes.option.dark' },
];

export function AppearanceSection({ theme, onThemeChange, tVault, disabled = false }: AppearanceSectionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = useId();

  const selectedIndex = useMemo(() => THEME_OPTIONS.findIndex((option) => option.value === theme), [theme]);

  const selectedLabel = useMemo(() => {
    const option = THEME_OPTIONS[selectedIndex] ?? THEME_OPTIONS[0];
    return tVault(option.labelKey);
  }, [selectedIndex, tVault]);

  const focusOption = useCallback((index: number) => {
    if (THEME_OPTIONS.length === 0) return;
    const normalizedIndex = ((index % THEME_OPTIONS.length) + THEME_OPTIONS.length) % THEME_OPTIONS.length;
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

  const handleSelect = useCallback(
    (nextTheme: ThemeOption) => {
      onThemeChange(nextTheme);
      closeMenuAndFocusTrigger();
    },
    [closeMenuAndFocusTrigger, onThemeChange],
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
          focusOption(currentIndex < 0 ? THEME_OPTIONS.length - 1 : currentIndex - 1);
          break;
        }
        case 'Home': {
          event.preventDefault();
          focusOption(0);
          break;
        }
        case 'End': {
          event.preventDefault();
          focusOption(THEME_OPTIONS.length - 1);
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
      <h3 id="appearance-title" className="settings-modal-section-title">
        {tVault('settingsModal.appearanceTitle')}
      </h3>

      <div role="group" aria-labelledby="appearance-title" className="settings-group">
        <div className="form-field settings-toggle-row">
          <div className="form-label settings-subheader" id="theme-label">
            {tVault('settingsModal.appearance.themes.title')}
          </div>

          <div className="settings-toggle-row__control">
            <div ref={dropdownRef} className="settings-language-dropdown">
              <button
                ref={triggerRef}
                id="theme-select-trigger"
                type="button"
                className="settings-language-dropdown__trigger"
                aria-labelledby="theme-label theme-select-trigger"
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
                  aria-labelledby="theme-label"
                  className="settings-language-dropdown__menu"
                  onKeyDown={handleMenuKeyDown}
                >
                  {THEME_OPTIONS.map((option, index) => {
                    const isSelected = option.value === theme;
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
