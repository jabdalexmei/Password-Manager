import React from 'react';
import { SETTINGS_LIMITS } from '../lib/settingsLimits';

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

type RenderSwitch = (params: {
  id: string;
  labelId: string;
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) => React.ReactNode;

type FeaturesSectionProps = {
  busy: boolean;
  softDeleteEnabled: boolean;
  trashAutoCleanupEnabled: boolean;
  setTrashAutoCleanupEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  trashRetentionDays: string;
  setTrashRetentionDays: React.Dispatch<React.SetStateAction<string>>;
  isTrashRetentionInvalid: boolean;
  parseTrashRetentionDays: (raw: string) => number | null;
  renderSwitch: RenderSwitch;
  tVault: TranslateFn;
};

export function FeaturesSection({
  busy,
  softDeleteEnabled,
  trashAutoCleanupEnabled,
  setTrashAutoCleanupEnabled,
  trashRetentionDays,
  setTrashRetentionDays,
  isTrashRetentionInvalid,
  parseTrashRetentionDays,
  renderSwitch,
  tVault,
}: FeaturesSectionProps) {
  return (
    <>
      <h3 id="features-title" className="settings-modal-section-title">
        {tVault('settingsModal.features.sectionTitle')}
      </h3>

      <div role="group" aria-labelledby="features-title" className="settings-group">
        <div className="form-field settings-toggle-row">
          <span className="form-label settings-subheader" id="trash-auto-cleanup-enabled-label">
            {tVault('settingsModal.features.automaticTrashCleanup.title')}
          </span>

          <div className="settings-toggle-row__control">
            {renderSwitch({
              id: 'trash-auto-cleanup-enabled-switch',
              labelId: 'trash-auto-cleanup-enabled-label',
              checked: trashAutoCleanupEnabled,
              onToggle: () =>
                setTrashAutoCleanupEnabled((value) => {
                  const nextValue = !value;
                  if (nextValue && parseTrashRetentionDays(trashRetentionDays) === null) {
                    setTrashRetentionDays('90');
                  }
                  return nextValue;
                }),
              disabled: busy || !softDeleteEnabled,
            })}
          </div>
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="trash-retention-days">
            {tVault('settingsModal.features.automaticTrashCleanup.daysLabel')}
          </label>
          <input
            id="trash-retention-days"
            type="number"
            min={SETTINGS_LIMITS.trashRetentionDays.min}
            max={SETTINGS_LIMITS.trashRetentionDays.max}
            value={trashRetentionDays}
            disabled={busy || !trashAutoCleanupEnabled || !softDeleteEnabled}
            inputMode="numeric"
            onChange={(event) => setTrashRetentionDays(event.target.value)}
            className="settings-input"
          />
          {isTrashRetentionInvalid && (
            <div className="form-error">{tVault('settingsModal.features.automaticTrashCleanup.validation')}</div>
          )}
        </div>

        {!softDeleteEnabled && (
          <div className="form-label">{tVault('settingsModal.features.automaticTrashCleanup.disabledBecauseTrashOff')}</div>
        )}
      </div>
    </>
  );
}
