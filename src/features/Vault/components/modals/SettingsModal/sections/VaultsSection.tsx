import React from 'react';

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

type RenderSwitch = (params: {
  id: string;
  labelId: string;
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) => React.ReactNode;

type VaultsSectionProps = {
  busy: boolean;
  multiplyVaultsEnabled: boolean;
  setMultiplyVaultsEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  renderSwitch: RenderSwitch;
  tVault: TranslateFn;
};

export function VaultsSection({
  busy,
  multiplyVaultsEnabled,
  setMultiplyVaultsEnabled,
  renderSwitch,
  tVault,
}: VaultsSectionProps) {
  return (
    <>
      <h3 id="vaults-title" className="settings-modal-section-title">
        {tVault('settingsModal.vaultsTitle')}
      </h3>

      <div role="group" aria-labelledby="vaults-title" className="settings-group">
        <div className="form-field settings-toggle-row">
          <span className="form-label settings-subheader" id="multiply-vaults-enabled-label">
            {tVault('settingsModal.multiplyVaults.enabled')}
          </span>

          <div className="settings-toggle-row__control">
            {renderSwitch({
              id: 'multiply-vaults-enabled-switch',
              labelId: 'multiply-vaults-enabled-label',
              checked: multiplyVaultsEnabled,
              onToggle: () => setMultiplyVaultsEnabled((value) => !value),
              disabled: busy,
            })}
          </div>
        </div>
      </div>
    </>
  );
}
