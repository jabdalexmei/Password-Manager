import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BackendUserSettings } from '../../../types/backend';
import { Language, useI18n, useTranslation } from '../../../../../shared/lib/i18n';
import { useToaster } from '../../../../../shared/components/Toaster';
import {
  changeProfilePassword,
  getAppTheme,
  removeProfilePassword,
  renameProfile,
  setAppTheme,
  setProfilePassword,
  type ProfileMeta,
} from '../../../../../shared/lib/tauri';
import { applyTheme, cacheTheme, type AppTheme } from '../../../../../shared/lib/theme';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../../../../shared/ui/dialog';
import { SettingsSidebar, type SettingsSection } from './components/SettingsSidebar';
import { GeneralSection } from './sections/GeneralSection';
import { AppearanceSection } from './sections/AppearanceSection';
import { ProfileSection } from './sections/ProfileSection';
import { SecuritySection } from './sections/SecuritySection';
import { FeaturesSection } from './sections/FeaturesSection';
import { VaultsSection } from './sections/VaultsSection';
import { BackupsSection } from './sections/BackupsSection';
import { parseTrashRetentionDays } from './lib/parseTrashRetentionDays';
import { validateSettings } from './lib/validateSettings';

export type SettingsModalProps = {
  open: boolean;
  settings: BackendUserSettings | null;
  isSaving: boolean;
  onCancel: () => void;
  onSave: (nextSettings: BackendUserSettings) => Promise<boolean>;
  profileId: string;
  profileName: string;
  profileHasPassword: boolean;
  onProfileRenamed?: (name: string) => void;
  onProfileUpdated?: (profile: ProfileMeta) => void;
};

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
  const { language, setLanguage } = useI18n();
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
  const [trashAutoCleanupEnabled, setTrashAutoCleanupEnabled] = useState(false);
  const [trashRetentionDays, setTrashRetentionDays] = useState('');
  const [multiplyVaultsEnabled, setMultiplyVaultsEnabled] = useState(false);
  const [theme, setTheme] = useState<AppTheme>('blueTheme');
  const [didTouchTheme, setDidTouchTheme] = useState(false);
  const [draftLanguage, setDraftLanguage] = useState<Language>('en');
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
  const [activeSection, setActiveSection] = useState<SettingsSection>('general');

  useEffect(() => {
    if (!open || !settings) return;
    setAutoLockEnabled(settings.auto_lock_enabled);
    setAutoLockTimeoutSeconds(String(settings.auto_lock_timeout));
    setClipboardAutoClearEnabled(settings.clipboard_auto_clear_enabled);
    setClipboardClearTimeoutSeconds(String(settings.clipboard_clear_timeout_seconds));
    setAutoBackupEnabled(settings.backups_enabled);
    setIntervalMinutes(String(settings.auto_backup_interval_minutes));
    setMaxCopies(String(settings.backup_max_copies));
    setTrashAutoCleanupEnabled(settings.trash_auto_cleanup_enabled);
    setTrashRetentionDays(String(settings.trash_retention_days));
    setMultiplyVaultsEnabled(settings.multiply_vaults_enabled);
  }, [open, settings]);

  useEffect(() => {
    if (!open) return;
    setActiveSection('general');
    setDraftLanguage(language);
  }, [language, open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setDidTouchTheme(false);

    getAppTheme()
      .then((nextTheme) => {
        if (cancelled) return;
        setTheme(nextTheme);
      })
      .catch(() => {
        // Keep current local state if global theme cannot be loaded.
      });

    return () => {
      cancelled = true;
    };
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
  const isTrashRetentionInvalid = trashAutoCleanupEnabled && parseTrashRetentionDays(trashRetentionDays) === null;

  const canSave = useMemo(
    () =>
      validateSettings({
        autoLockEnabled,
        autoLockTimeoutSeconds,
        clipboardClearTimeoutSeconds,
        autoBackupEnabled,
        intervalMinutes,
        maxCopies,
        trashAutoCleanupEnabled,
        trashRetentionDays,
      }),
    [
      autoBackupEnabled,
      autoLockEnabled,
      autoLockTimeoutSeconds,
      clipboardClearTimeoutSeconds,
      intervalMinutes,
      maxCopies,
      trashAutoCleanupEnabled,
      trashRetentionDays,
    ],
  );

  const canSaveRename = useMemo(() => {
    const next = renameProfileValue.trim();
    if (!next) return false;
    if (next === (profileName || '').trim()) return false;
    return true;
  }, [profileName, renameProfileValue]);

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

  const handleSetPasswordSave = async () => {
    if (profileHasPassword) return;
    if (!canSaveSetPassword) return;

    setIsSettingPassword(true);
    try {
      const updated = await setProfilePassword(profileId, setPasswordValue);
      onProfileUpdated?.(updated);
      showToast(tVault('settingsModal.profile.setPasswordSuccess'));
      setSetPasswordOpen(false);
    } catch (error) {
      console.error('profile_set_password failed:', error);
      const err = error as any;
      const code = err?.code ?? err?.error?.code ?? err?.message ?? 'UNKNOWN_ERROR';
      console.error('profile_set_password error details:', { code, details: err });
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

  const handleSave = async () => {
    if (!settings) return;

    const lockTimeout = Number(autoLockTimeoutSeconds);
    const clipTimeout = Number(clipboardClearTimeoutSeconds);
    const interval = Number(intervalMinutes);
    const max = Number(maxCopies);
    const retentionDays = parseTrashRetentionDays(trashRetentionDays);

    if (!Number.isFinite(lockTimeout) || !Number.isFinite(clipTimeout) || !Number.isFinite(interval) || !Number.isFinite(max)) return;
    if (autoLockEnabled && (lockTimeout < 30 || lockTimeout > 86400)) return;
    if (clipTimeout < 1 || clipTimeout > 600) return;
    if (autoBackupEnabled && (interval < 5 || interval > 1440)) return;
    if (max < 1 || max > 500) return;
    if (trashAutoCleanupEnabled && retentionDays === null) return;

    const saved = await onSave({
      ...settings,
      auto_lock_enabled: autoLockEnabled,
      auto_lock_timeout: Math.round(lockTimeout),
      clipboard_auto_clear_enabled: clipboardAutoClearEnabled,
      clipboard_clear_timeout_seconds: Math.round(clipTimeout),
      soft_delete_enabled: settings.soft_delete_enabled,
      trash_auto_cleanup_enabled: trashAutoCleanupEnabled,
      trash_retention_days:
        trashAutoCleanupEnabled && retentionDays !== null ? retentionDays : settings.trash_retention_days,
      backups_enabled: autoBackupEnabled,
      auto_backup_interval_minutes: Math.round(interval),
      backup_max_copies: Math.round(max),
      multiply_vaults_enabled: multiplyVaultsEnabled,
    });

    if (!saved) return;

    if (language !== draftLanguage) {
      setLanguage(draftLanguage);
    }

    if (!didTouchTheme) return;

    try {
      await setAppTheme(theme);
      applyTheme(theme);
      cacheTheme(theme);
    } catch (error) {
      const code = (error as any)?.code ?? (error as any)?.error ?? 'UNKNOWN';
      showToast(`${tCommon('error.operationFailed')} (${code})`, 'error');
    }
  };

  const onSwitchKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, onToggle: () => void) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onToggle();
    }
  };

  const renderSwitch = useCallback(
    ({
      id,
      labelId,
      checked,
      onToggle,
      disabled,
    }: {
      id: string;
      labelId: string;
      checked: boolean;
      onToggle: () => void;
      disabled?: boolean;
    }) => (
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
        onKeyDown={(event) => onSwitchKeyDown(event, onToggle)}
      >
        <span className="pm-switch__thumb" />
      </button>
    ),
    [],
  );

  const handleLanguageChange = useCallback(
    (nextLanguage: Language) => {
      setDraftLanguage(nextLanguage);
    },
    [],
  );

  const handleThemeChange = useCallback(
    (nextTheme: AppTheme) => {
      setTheme(nextTheme);
      setDidTouchTheme(true);
    },
    [],
  );

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (!nextOpen ? onCancel() : undefined)}>
      <DialogContent aria-labelledby="settings-title" className="settings-modal">
        <DialogHeader>
          <DialogTitle id="settings-title">{tVault('settings')}</DialogTitle>
        </DialogHeader>

        <div className="dialog-body settings-modal-body">
          <div className="settings-layout">
            <SettingsSidebar activeSection={activeSection} onChangeSection={setActiveSection} tVault={tVault} />

            <section className="settings-content">
              {activeSection === 'general' && (
                <GeneralSection language={draftLanguage} onLanguageChange={handleLanguageChange} tVault={tVault} disabled={busy} />
              )}

              {activeSection === 'appearance' && (
                <AppearanceSection theme={theme} onThemeChange={handleThemeChange} tVault={tVault} disabled={busy} />
              )}

              {activeSection === 'profile' && (
                <ProfileSection
                  busy={busy}
                  profileHasPassword={profileHasPassword}
                  isRenamingProfile={isRenamingProfile}
                  isSettingPassword={isSettingPassword}
                  isChangingPassword={isChangingPassword}
                  isRemovingPassword={isRemovingPassword}
                  renameProfileOpen={renameProfileOpen}
                  setRenameProfileOpen={setRenameProfileOpen}
                  renameProfileValue={renameProfileValue}
                  setRenameProfileValue={setRenameProfileValue}
                  canSaveRename={canSaveRename}
                  onRenameSave={handleRenameSave}
                  setPasswordOpen={setPasswordOpen}
                  setSetPasswordOpen={setSetPasswordOpen}
                  setPasswordValue={setPasswordValue}
                  setSetPasswordValue={setSetPasswordValue}
                  setPasswordConfirm={setPasswordConfirm}
                  setSetPasswordConfirm={setSetPasswordConfirm}
                  canSaveSetPassword={canSaveSetPassword}
                  onSetPasswordSave={handleSetPasswordSave}
                  changePasswordOpen={changePasswordOpen}
                  setChangePasswordOpen={setChangePasswordOpen}
                  changePasswordValue={changePasswordValue}
                  setChangePasswordValue={setChangePasswordValue}
                  changePasswordConfirm={changePasswordConfirm}
                  setChangePasswordConfirm={setChangePasswordConfirm}
                  canSaveChangePassword={canSaveChangePassword}
                  onChangePasswordSave={handleChangePasswordSave}
                  removePasswordConfirmOpen={removePasswordConfirmOpen}
                  setRemovePasswordConfirmOpen={setRemovePasswordConfirmOpen}
                  onRemovePasswordConfirm={handleRemovePasswordConfirm}
                  tVault={tVault}
                  tCommon={tCommon}
                />
              )}

              {activeSection === 'security' && (
                <SecuritySection
                  busy={busy}
                  autoLockEnabled={autoLockEnabled}
                  setAutoLockEnabled={setAutoLockEnabled}
                  autoLockTimeoutSeconds={autoLockTimeoutSeconds}
                  setAutoLockTimeoutSeconds={setAutoLockTimeoutSeconds}
                  clipboardAutoClearEnabled={clipboardAutoClearEnabled}
                  setClipboardAutoClearEnabled={setClipboardAutoClearEnabled}
                  clipboardClearTimeoutSeconds={clipboardClearTimeoutSeconds}
                  setClipboardClearTimeoutSeconds={setClipboardClearTimeoutSeconds}
                  renderSwitch={renderSwitch}
                  tVault={tVault}
                />
              )}

              {activeSection === 'features' && (
                <FeaturesSection
                  busy={busy}
                  softDeleteEnabled={Boolean(settings?.soft_delete_enabled)}
                  trashAutoCleanupEnabled={trashAutoCleanupEnabled}
                  setTrashAutoCleanupEnabled={setTrashAutoCleanupEnabled}
                  trashRetentionDays={trashRetentionDays}
                  setTrashRetentionDays={setTrashRetentionDays}
                  isTrashRetentionInvalid={isTrashRetentionInvalid}
                  parseTrashRetentionDays={parseTrashRetentionDays}
                  renderSwitch={renderSwitch}
                  tVault={tVault}
                />
              )}

              {activeSection === 'vaults' && (
                <VaultsSection
                  busy={busy}
                  multiplyVaultsEnabled={multiplyVaultsEnabled}
                  setMultiplyVaultsEnabled={setMultiplyVaultsEnabled}
                  renderSwitch={renderSwitch}
                  tVault={tVault}
                />
              )}

              {activeSection === 'backups' && (
                <BackupsSection
                  busy={busy}
                  autoBackupEnabled={autoBackupEnabled}
                  setAutoBackupEnabled={setAutoBackupEnabled}
                  intervalMinutes={intervalMinutes}
                  setIntervalMinutes={setIntervalMinutes}
                  maxCopies={maxCopies}
                  setMaxCopies={setMaxCopies}
                  renderSwitch={renderSwitch}
                  tVault={tVault}
                />
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
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => {
                void handleSave();
              }}
              disabled={busy || !settings || !canSave}
            >
              {tVault('backup.settings.save')}
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
