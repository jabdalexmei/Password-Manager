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

type SecuritySectionProps = {
  busy: boolean;
  autoLockEnabled: boolean;
  setAutoLockEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  autoLockTimeoutSeconds: string;
  setAutoLockTimeoutSeconds: React.Dispatch<React.SetStateAction<string>>;
  clipboardAutoClearEnabled: boolean;
  setClipboardAutoClearEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  clipboardClearTimeoutSeconds: string;
  setClipboardClearTimeoutSeconds: React.Dispatch<React.SetStateAction<string>>;
  renderSwitch: RenderSwitch;
  tVault: TranslateFn;
};

export function SecuritySection({
  busy,
  autoLockEnabled,
  setAutoLockEnabled,
  autoLockTimeoutSeconds,
  setAutoLockTimeoutSeconds,
  clipboardAutoClearEnabled,
  setClipboardAutoClearEnabled,
  clipboardClearTimeoutSeconds,
  setClipboardClearTimeoutSeconds,
  renderSwitch,
  tVault,
}: SecuritySectionProps) {
  return (
    <>
      <h3 id="security-title" className="settings-modal-section-title">
        {tVault('settingsModal.securityTitle')}
      </h3>

      <div role="group" aria-labelledby="security-title" className="settings-group">
        <div className="form-field settings-toggle-row">
          <span className="form-label settings-subheader" id="auto-lock-enabled-label">
            {tVault('settingsModal.autoLock.enabled')}
          </span>

          <div className="settings-toggle-row__control">
            {renderSwitch({
              id: 'auto-lock-enabled-switch',
              labelId: 'auto-lock-enabled-label',
              checked: autoLockEnabled,
              onToggle: () => setAutoLockEnabled((value) => !value),
              disabled: busy,
            })}
          </div>
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="auto-lock-timeout-seconds">
            {tVault('settingsModal.autoLock.timeoutSeconds')}
          </label>
          <input
            id="auto-lock-timeout-seconds"
            type="number"
            min={SETTINGS_LIMITS.autoLockTimeoutSeconds.min}
            max={SETTINGS_LIMITS.autoLockTimeoutSeconds.max}
            value={autoLockTimeoutSeconds}
            disabled={busy || !autoLockEnabled}
            inputMode="numeric"
            onChange={(event) => setAutoLockTimeoutSeconds(event.target.value)}
            className="settings-input"
          />
        </div>

        <div className="form-field settings-toggle-row">
          <span className="form-label settings-subheader" id="clipboard-auto-clear-enabled-label">
            {tVault('settingsModal.clipboard.enabled')}
          </span>

          <div className="settings-toggle-row__control">
            {renderSwitch({
              id: 'clipboard-auto-clear-enabled-switch',
              labelId: 'clipboard-auto-clear-enabled-label',
              checked: clipboardAutoClearEnabled,
              onToggle: () => setClipboardAutoClearEnabled((value) => !value),
              disabled: busy,
            })}
          </div>
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="clipboard-clear-timeout-seconds">
            {tVault('settingsModal.clipboard.timeoutSeconds')}
          </label>
          <input
            id="clipboard-clear-timeout-seconds"
            type="number"
            min={SETTINGS_LIMITS.clipboardClearTimeoutSeconds.min}
            max={SETTINGS_LIMITS.clipboardClearTimeoutSeconds.max}
            value={clipboardClearTimeoutSeconds}
            disabled={busy || !clipboardAutoClearEnabled}
            inputMode="numeric"
            onChange={(event) => setClipboardClearTimeoutSeconds(event.target.value)}
            className="settings-input"
          />
        </div>
      </div>
    </>
  );
}
