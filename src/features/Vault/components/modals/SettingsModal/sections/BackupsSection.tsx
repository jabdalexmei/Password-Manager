import React from 'react';

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

type RenderSwitch = (params: {
  id: string;
  labelId: string;
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) => React.ReactNode;

type BackupsSectionProps = {
  busy: boolean;
  autoBackupEnabled: boolean;
  setAutoBackupEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  intervalMinutes: string;
  setIntervalMinutes: React.Dispatch<React.SetStateAction<string>>;
  maxCopies: string;
  setMaxCopies: React.Dispatch<React.SetStateAction<string>>;
  renderSwitch: RenderSwitch;
  tVault: TranslateFn;
};

export function BackupsSection({
  busy,
  autoBackupEnabled,
  setAutoBackupEnabled,
  intervalMinutes,
  setIntervalMinutes,
  maxCopies,
  setMaxCopies,
  renderSwitch,
  tVault,
}: BackupsSectionProps) {
  return (
    <>
      <h3 id="backups-title" className="settings-modal-section-title">
        {tVault('backup.settings.title')}
      </h3>

      <div role="group" aria-labelledby="backups-title" className="settings-group">
        <div className="form-field settings-toggle-row">
          <span className="form-label settings-subheader" id="backup-auto-enabled-label">
            {tVault('backup.settings.autoEnabled')}
          </span>

          <div className="settings-toggle-row__control">
            {renderSwitch({
              id: 'backup-auto-enabled-switch',
              labelId: 'backup-auto-enabled-label',
              checked: autoBackupEnabled,
              onToggle: () => setAutoBackupEnabled((value) => !value),
              disabled: busy,
            })}
          </div>
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="backup-interval-minutes">
            {tVault('backup.settings.intervalMinutes')}
          </label>
          <input
            id="backup-interval-minutes"
            type="number"
            min={5}
            max={1440}
            value={intervalMinutes}
            disabled={busy || !autoBackupEnabled}
            inputMode="numeric"
            onChange={(event) => setIntervalMinutes(event.target.value)}
            className="settings-input"
          />
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="backup-max-copies">
            {tVault('backup.settings.maxCopies')}
          </label>
          <input
            id="backup-max-copies"
            type="number"
            min={1}
            max={500}
            value={maxCopies}
            disabled={busy}
            inputMode="numeric"
            onChange={(event) => setMaxCopies(event.target.value)}
            className="settings-input"
          />
        </div>
      </div>
    </>
  );
}
