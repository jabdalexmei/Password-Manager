import React from 'react';

type ThemeOption = 'blueTheme' | 'darkTheme';

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

type AppearanceSectionProps = {
  theme: ThemeOption;
  onThemeChange: (theme: ThemeOption) => void;
  tVault: TranslateFn;
  disabled?: boolean;
};

export function AppearanceSection({ theme, onThemeChange, tVault, disabled = false }: AppearanceSectionProps) {
  return (
    <>
      <h3 id="appearance-title" className="settings-modal-section-title">
        {tVault('settingsModal.appearanceTitle')}
      </h3>

      <div role="group" aria-labelledby="appearance-title" className="settings-group">
        <div className="form-field settings-toggle-row">
          <div className="form-label settings-subheader">{tVault('settingsModal.appearance.themes.title')}</div>

          <div className="settings-toggle-row__control" style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn-secondary"
              data-active={theme === 'blueTheme' ? 'true' : 'false'}
              onClick={() => onThemeChange('blueTheme')}
              disabled={disabled}
            >
              {tVault('settingsModal.appearance.themes.option.blue')}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              data-active={theme === 'darkTheme' ? 'true' : 'false'}
              onClick={() => onThemeChange('darkTheme')}
              disabled={disabled}
            >
              {tVault('settingsModal.appearance.themes.option.dark')}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
