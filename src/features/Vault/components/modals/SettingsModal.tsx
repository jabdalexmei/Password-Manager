import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BackendUserSettings } from '../../types/backend';
import { useTranslation } from '../../../../shared/lib/i18n';
import { useToaster } from '../../../../shared/components/Toaster';
import ConfirmDialog from '../../../../shared/components/ConfirmDialog';
import {
  changeProfilePassword,
  removeProfilePassword,
  renameProfile,
  setProfilePassword,
  type ProfileMeta,
} from '../../../../shared/lib/tauri';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../../../shared/ui/dialog';

export type SettingsModalProps = {
  open: boolean;
  settings: BackendUserSettings | null;
  isSaving: boolean;
  onCancel: () => void;
  onSave: (nextSettings: BackendUserSettings) => void;
  profileId: string;
  profileName: string;
  profileHasPassword: boolean;
  onProfileRenamed?: (name: string) => void;
  onProfileUpdated?: (profile: ProfileMeta) => void;
};

type SettingsSection = 'profile' | 'security' | 'vaults' | 'backups';

export function SettingsModal({
  open,
  settings,
  isSaving,
  onCancel,
  onSave,
  profileId,
  profileName,
  profileHasPassword,
  onProfileRenamed,
  onProfileUpdated,
}: SettingsModalProps) {
  const { t: tVault } = useTranslation('Vault');
  const { t: tCommon } = useTranslation('Common');
  const { show: showToast } = useToaster();

  const [autoLockEnabled, setAutoLockEnabled] = useState(false);
  const [autoLockTimeoutSeconds, setAutoLockTimeoutSeconds] = useState('60');
  const [clipboardAutoClearEnabled, setClipboardAutoClearEnabled] = useState(false);
  const [clipboardClearTimeoutSeconds, setClipboardClearTimeoutSeconds] = useState('20');
  const [autoBackupEnabled, setAutoBackupEnabled] = useState(false);
  const [intervalMinutes, setIntervalMinutes] = useState('60');
  const [maxCopies, setMaxCopies] = useState('10');
  const [multiplyVaultsEnabled, setMultiplyVaultsEnabled] = useState(false);
  const [renameProfileOpen, setRenameProfileOpen] = useState(false);
  const [renameProfileValue, setRenameProfileValue] = useState('');
  const [isRenamingProfile, setIsRenamingProfile] = useState(false);

  const [setPasswordOpen, setSetPasswordOpen] = useState(false);
  const [setPasswordValue, setSetPasswordValue] = useState('');
  const [setPasswordConfirm, setSetPasswordConfirm] = useState('');
  const [isSettingPassword, setIsSettingPassword] = useState(false);

  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [changePasswordValue, setChangePasswordValue] = useState('');
  const [changePasswordConfirm, setChangePasswordConfirm] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  const [removePasswordConfirmOpen, setRemovePasswordConfirmOpen] = useState(false);
  const [isRemovingPassword, setIsRemovingPassword] = useState(false);
  const [activeSection, setActiveSection] = useState<SettingsSection>('profile');

  useEffect(() => {
    if (!open || !settings) return;
    setAutoLockEnabled(settings.auto_lock_enabled);
    setAutoLockTimeoutSeconds(String(settings.auto_lock_timeout));
    setClipboardAutoClearEnabled(settings.clipboard_auto_clear_enabled);
    setClipboardClearTimeoutSeconds(String(settings.clipboard_clear_timeout_seconds));
    setAutoBackupEnabled(settings.backups_enabled);
    setIntervalMinutes(String(settings.auto_backup_interval_minutes));
    setMaxCopies(String(settings.backup_max_copies));
    setMultiplyVaultsEnabled(settings.multiply_vaults_enabled);
  }, [open, settings]);

  useEffect(() => {
    if (!open) return;
    setActiveSection('profile');
  }, [open]);

  useEffect(() => {
    if (!renameProfileOpen) return;
    setRenameProfileValue(profileName || '');
  }, [renameProfileOpen, profileName]);

  useEffect(() => {
    if (!setPasswordOpen) return;
    setSetPasswordValue('');
    setSetPasswordConfirm('');
  }, [setPasswordOpen]);

  useEffect(() => {
    if (!changePasswordOpen) return;
    setChangePasswordValue('');
    setChangePasswordConfirm('');
  }, [changePasswordOpen]);

  useEffect(() => {
    if (profileHasPassword) return;
    setRemovePasswordConfirmOpen(false);
  }, [profileHasPassword]);

  const busy = isSaving;

  const canSave = useMemo(() => {
    const lockTimeout = Number(autoLockTimeoutSeconds);
    const clipTimeout = Number(clipboardClearTimeoutSeconds);
    const interval = Number(intervalMinutes);
    const max = Number(maxCopies);
    if (
      !Number.isFinite(lockTimeout) ||
      !Number.isFinite(clipTimeout) ||
      !Number.isFinite(interval) ||
      !Number.isFinite(max)
    ) {
      return false;
    }
    if (autoLockEnabled && (lockTimeout < 30 || lockTimeout > 86400)) return false;
    if (clipTimeout < 1 || clipTimeout > 600) return false;
    if (autoBackupEnabled && (interval < 5 || interval > 1440)) return false;
    if (max < 1 || max > 500) return false;
    return true;
  }, [
    autoBackupEnabled,
    autoLockEnabled,
    autoLockTimeoutSeconds,
    clipboardClearTimeoutSeconds,
    intervalMinutes,
    maxCopies,
  ]);

  const canSaveRename = useMemo(() => {
    const next = renameProfileValue.trim();
    if (!next) return false;
    if (next === (profileName || '').trim()) return false;
    return true;
  }, [profileName, renameProfileValue]);

  const handleRenameSave = async () => {
    const next = renameProfileValue.trim();
    if (!next) return;

    setIsRenamingProfile(true);
    try {
      const updated = await renameProfile(profileId, next);
      onProfileRenamed?.(updated.name);
      showToast(tVault('settingsModal.profile.renameSuccess'));
      setRenameProfileOpen(false);
    } catch {
      showToast(tVault('settingsModal.profile.renameError'), 'error');
    } finally {
      setIsRenamingProfile(false);
    }
  };

  const canSaveSetPassword = useMemo(() => {
    if (profileHasPassword) return false;
    const p1 = setPasswordValue;
    const p2 = setPasswordConfirm;
    if (!p1 || !p2) return false;
    if (p1 !== p2) return false;
    return true;
  }, [profileHasPassword, setPasswordConfirm, setPasswordValue]);

  const canSaveChangePassword = useMemo(() => {
    if (!profileHasPassword) return false;
    const p1 = changePasswordValue;
    const p2 = changePasswordConfirm;
    if (!p1 || !p2) return false;
    if (p1 !== p2) return false;
    return true;
  }, [changePasswordConfirm, changePasswordValue, profileHasPassword]);

  const handleSetPasswordSave = async () => {
    if (profileHasPassword) return;
    if (!canSaveSetPassword) return;

    setIsSettingPassword(true);
    try {
      const updated = await setProfilePassword(profileId, setPasswordValue);
      onProfileUpdated?.(updated);
      showToast(tVault('settingsModal.profile.setPasswordSuccess'));
      setSetPasswordOpen(false);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('profile_set_password failed:', e);

      // Our backend uses structured error objects (e.g. { code: "DB_QUERY_FAILED" }).
      const err = e as any;
      const code =
        err?.code ??
        err?.error?.code ??
        err?.message ??
        'UNKNOWN_ERROR';

      let details = '';
      try {
        details = JSON.stringify(err);
      } catch {
        details = String(err);
      }

      // eslint-disable-next-line no-console
      console.error('profile_set_password error details:', { code, details });

      // Keep toast short but informative.
      showToast(`${tVault('settingsModal.profile.setPasswordError')}: ${code}`, 'error');
    } finally {
      setIsSettingPassword(false);
    }
  };

  const handleChangePasswordSave = async () => {
    if (!profileHasPassword) return;
    if (!canSaveChangePassword) return;

    setIsChangingPassword(true);
    try {
      await changeProfilePassword(profileId, changePasswordValue);
      showToast(tVault('settingsModal.profile.changePasswordSuccess'));
      setChangePasswordOpen(false);
    } catch {
      showToast(tVault('settingsModal.profile.changePasswordError'), 'error');
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleRemovePasswordConfirm = async () => {
    if (!profileHasPassword) return;

    setIsRemovingPassword(true);
    try {
      const updated = await removeProfilePassword(profileId);
      onProfileUpdated?.(updated);
      showToast(tVault('settingsModal.profile.removePasswordSuccess'));
      setRemovePasswordConfirmOpen(false);
    } catch {
      showToast(tVault('settingsModal.profile.removePasswordError'), 'error');
    } finally {
      setIsRemovingPassword(false);
    }
  };

  const handleSave = () => {
    if (!settings) return;

    const lockTimeout = Number(autoLockTimeoutSeconds);
    const clipTimeout = Number(clipboardClearTimeoutSeconds);
    const interval = Number(intervalMinutes);
    const max = Number(maxCopies);

    if (!Number.isFinite(lockTimeout)) return;
    if (autoLockEnabled && (lockTimeout < 30 || lockTimeout > 86400)) return;
    if (!Number.isFinite(clipTimeout) || clipTimeout < 1 || clipTimeout > 600) return;
    if (!Number.isFinite(interval) || !Number.isFinite(max)) return;
    if (autoBackupEnabled && (interval < 5 || interval > 1440)) return;
    if (max < 1 || max > 500) return;

    const nextSettings: BackendUserSettings = {
      ...settings,
      auto_lock_enabled: autoLockEnabled,
      auto_lock_timeout: lockTimeout,
      clipboard_auto_clear_enabled: clipboardAutoClearEnabled,
      clipboard_clear_timeout_seconds: clipTimeout,
      backups_enabled: autoBackupEnabled,
      auto_backup_interval_minutes: interval,
      backup_max_copies: max,
      multiply_vaults_enabled: multiplyVaultsEnabled,
    };

    onSave(nextSettings);
  };

  const onSwitchKeyDown = useCallback((e: React.KeyboardEvent, toggle: () => void) => {
    if (busy) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      toggle();
    }
  }, [busy]);

  const renderSwitch = useCallback(
    (opts: {
      id: string;
      labelId: string;
      checked: boolean;
      onToggle: () => void;
      disabled?: boolean;
    }) => {
      const { id, labelId, checked, onToggle, disabled } = opts;
      return (
        <button
          id={id}
          type="button"
          role="switch"
          aria-checked={checked}
          aria-labelledby={labelId}
          disabled={!!disabled}
          data-checked={checked ? 'true' : 'false'}
          className="pm-switch"
          onClick={onToggle}
          onKeyDown={(e) => onSwitchKeyDown(e, onToggle)}
        >
          <span className="pm-switch__thumb" />
        </button>
      );
    },
    [onSwitchKeyDown],
  );

  return (
    <>
      <Dialog open={open} onOpenChange={(nextOpen) => (!nextOpen ? onCancel() : undefined)}>
      <DialogContent aria-labelledby="settings-title" className="settings-modal">
        <DialogHeader>
          <DialogTitle id="settings-title">{tVault('settings')}</DialogTitle>
        </DialogHeader>

        <div className="dialog-body settings-modal-body">
          <div className="settings-layout">
            <aside className="settings-sidebar" aria-label={tVault('settingsModal.optionsTitle')}>
              <div className="settings-sidebar-title">{tVault('settingsModal.optionsTitle')}</div>
              <nav className="settings-sidebar-nav" aria-label={tVault('settingsModal.optionsTitle')}>
                <button
                  type="button"
                  className="settings-nav-item"
                  data-active={activeSection === 'profile' ? 'true' : 'false'}
                  onClick={() => setActiveSection('profile')}
                >
                  {tVault('settingsModal.profileTitle')}
                </button>
                <button
                  type="button"
                  className="settings-nav-item"
                  data-active={activeSection === 'security' ? 'true' : 'false'}
                  onClick={() => setActiveSection('security')}
                >
                  {tVault('settingsModal.securityTitle')}
                </button>
                <button
                  type="button"
                  className="settings-nav-item"
                  data-active={activeSection === 'vaults' ? 'true' : 'false'}
                  onClick={() => setActiveSection('vaults')}
                >
                  {tVault('settingsModal.vaultsTitle')}
                </button>
                <button
                  type="button"
                  className="settings-nav-item"
                  data-active={activeSection === 'backups' ? 'true' : 'false'}
                  onClick={() => setActiveSection('backups')}
                >
                  {tVault('backup.settings.title')}
                </button>
              </nav>
            </aside>

            <section className="settings-content">
              {activeSection === 'profile' && (
                <>
                  <h3 id="profile-title" className="settings-modal-section-title">
                    {tVault('settingsModal.profileTitle')}
                  </h3>

                  <div className="settings-profile-actions" role="group" aria-labelledby="profile-title">
                    <button
                      className="btn btn-secondary settings-profile-action"
                      type="button"
                      onClick={() => setRenameProfileOpen(true)}
                      disabled={busy}
                    >
                      {tVault('settingsModal.profile.rename')}
                    </button>

                    <button
                      className="btn btn-secondary settings-profile-action"
                      type="button"
                      onClick={() => setSetPasswordOpen(true)}
                      disabled={busy || isRenamingProfile || isSettingPassword || profileHasPassword}
                    >
                      {tVault('settingsModal.profile.setPasswordAction')}
                    </button>

                    <button
                      className="btn btn-secondary settings-profile-action"
                      type="button"
                      onClick={() => setChangePasswordOpen(true)}
                      disabled={busy || isRenamingProfile || isChangingPassword || !profileHasPassword}
                    >
                      {tVault('settingsModal.profile.changePasswordAction')}
                    </button>

                    <button
                      className="btn btn-danger settings-profile-action"
                      type="button"
                      onClick={() => setRemovePasswordConfirmOpen(true)}
                      disabled={
                        busy ||
                        isRenamingProfile ||
                        isSettingPassword ||
                        isChangingPassword ||
                        isRemovingPassword ||
                        !profileHasPassword
                      }
                    >
                      {tVault('settingsModal.profile.removePasswordAction')}
                    </button>
                  </div>
                </>
              )}

              {activeSection === 'security' && (
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
                          onToggle: () => setAutoLockEnabled((v) => !v),
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
                        min={30}
                        max={86400}
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
                          onToggle: () => setClipboardAutoClearEnabled((v) => !v),
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
                        min={1}
                        max={600}
                        value={clipboardClearTimeoutSeconds}
                        disabled={busy || !clipboardAutoClearEnabled}
                        inputMode="numeric"
                        onChange={(event) => setClipboardClearTimeoutSeconds(event.target.value)}
                        className="settings-input"
                      />
                    </div>
                  </div>
                </>
              )}

              {activeSection === 'vaults' && (
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
                          onToggle: () => setMultiplyVaultsEnabled((v) => !v),
                          disabled: busy,
                        })}
                      </div>
                    </div>
                  </div>
                </>
              )}

              {activeSection === 'backups' && (
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
                          onToggle: () => setAutoBackupEnabled((v) => !v),
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
              )}
            </section>
          </div>
        </div>

        <DialogFooter className="dialog-footer--split">
          <div className="dialog-footer-left">
            <button className="btn btn-secondary" type="button" onClick={onCancel} disabled={busy}>
              {tCommon('action.cancel')}
            </button>
          </div>

          <div className="dialog-footer-right">
            <button className="btn btn-primary" type="button" onClick={handleSave} disabled={busy || !settings || !canSave}>
              {tVault('backup.settings.save')}
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog
      open={renameProfileOpen}
      onOpenChange={(nextOpen) => (!nextOpen ? setRenameProfileOpen(false) : undefined)}
    >
      <DialogContent aria-labelledby="rename-profile-title">
        <DialogHeader>
          <DialogTitle id="rename-profile-title">{tVault('settingsModal.profile.renameTitle')}</DialogTitle>
        </DialogHeader>

        <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="form-field">
            <label className="form-label" htmlFor="rename-profile-input">
              {tVault('settingsModal.profile.nameLabel')}
            </label>
            <input
              id="rename-profile-input"
              type="text"
              value={renameProfileValue}
              disabled={busy || isRenamingProfile}
              onChange={(event) => setRenameProfileValue(event.target.value)}
              autoComplete="off"
              className="settings-input"
            />
          </div>
        </div>

        <DialogFooter className="dialog-footer--split">
          <div className="dialog-footer-left">
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => setRenameProfileOpen(false)}
              disabled={busy || isRenamingProfile}
            >
              {tCommon('action.cancel')}
            </button>
          </div>

          <div className="dialog-footer-right">
            <button
              className="btn btn-primary"
              type="button"
              onClick={handleRenameSave}
              disabled={busy || isRenamingProfile || !canSaveRename}
            >
              {tVault('backup.settings.save')}
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={setPasswordOpen} onOpenChange={(nextOpen) => (!nextOpen ? setSetPasswordOpen(false) : undefined)}>
      <DialogContent aria-labelledby="set-password-title">
        <DialogHeader>
          <DialogTitle id="set-password-title">{tVault('settingsModal.profile.setPasswordTitle')}</DialogTitle>
        </DialogHeader>

        <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="form-field">
            <label className="form-label" htmlFor="set-password-input">
              {tVault('settingsModal.profile.passwordLabel')}
            </label>
            <input
              id="set-password-input"
              type="password"
              value={setPasswordValue}
              disabled={busy || isSettingPassword || profileHasPassword}
              onChange={(e) => setSetPasswordValue(e.target.value)}
              autoComplete="new-password"
              className="settings-input"
            />
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="set-password-confirm-input">
              {tVault('settingsModal.profile.confirmPasswordLabel')}
            </label>
            <input
              id="set-password-confirm-input"
              type="password"
              value={setPasswordConfirm}
              disabled={busy || isSettingPassword || profileHasPassword}
              onChange={(e) => setSetPasswordConfirm(e.target.value)}
              autoComplete="new-password"
              className="settings-input"
            />
          </div>
        </div>

        <DialogFooter className="dialog-footer--split">
          <div className="dialog-footer-left">
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => setSetPasswordOpen(false)}
              disabled={busy || isSettingPassword}
            >
              {tCommon('action.cancel')}
            </button>
          </div>

          <div className="dialog-footer-right">
            <button
              className="btn btn-primary"
              type="button"
              onClick={handleSetPasswordSave}
              disabled={busy || isSettingPassword || !canSaveSetPassword}
            >
              {tVault('backup.settings.save')}
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog
      open={changePasswordOpen}
      onOpenChange={(nextOpen) => (!nextOpen ? setChangePasswordOpen(false) : undefined)}
    >
      <DialogContent aria-labelledby="change-password-title">
        <DialogHeader>
          <DialogTitle id="change-password-title">{tVault('settingsModal.profile.changePasswordTitle')}</DialogTitle>
        </DialogHeader>

        <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="form-field">
            <label className="form-label" htmlFor="change-password-input">
              {tVault('settingsModal.profile.passwordLabel')}
            </label>
            <input
              id="change-password-input"
              type="password"
              value={changePasswordValue}
              disabled={busy || isChangingPassword || !profileHasPassword}
              onChange={(e) => setChangePasswordValue(e.target.value)}
              autoComplete="new-password"
              className="settings-input"
            />
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="change-password-confirm-input">
              {tVault('settingsModal.profile.confirmPasswordLabel')}
            </label>
            <input
              id="change-password-confirm-input"
              type="password"
              value={changePasswordConfirm}
              disabled={busy || isChangingPassword || !profileHasPassword}
              onChange={(e) => setChangePasswordConfirm(e.target.value)}
              autoComplete="new-password"
              className="settings-input"
            />
          </div>
        </div>

        <DialogFooter className="dialog-footer--split">
          <div className="dialog-footer-left">
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => setChangePasswordOpen(false)}
              disabled={busy || isChangingPassword}
            >
              {tCommon('action.cancel')}
            </button>
          </div>

          <div className="dialog-footer-right">
            <button
              className="btn btn-primary"
              type="button"
              onClick={handleChangePasswordSave}
              disabled={busy || isChangingPassword || !canSaveChangePassword}
            >
              {tVault('backup.settings.save')}
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <ConfirmDialog
      open={removePasswordConfirmOpen}
      title={tVault('settingsModal.profile.removePasswordTitle')}
      description={tVault('settingsModal.profile.removePasswordDescription')}
      confirmLabel={tVault('settingsModal.profile.removePasswordConfirmAction')}
      cancelLabel={tCommon('action.cancel')}
      onConfirm={handleRemovePasswordConfirm}
      onCancel={() => setRemovePasswordConfirmOpen(false)}
      confirmDisabled={busy || isRemovingPassword}
      cancelDisabled={busy || isRemovingPassword}
    />
    </>
  );
}
