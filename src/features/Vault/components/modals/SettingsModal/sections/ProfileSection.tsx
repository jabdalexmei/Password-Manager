import React, { useEffect, useState } from 'react';
import ConfirmDialog from '../../../../../../shared/components/ConfirmDialog';
import { IconPreview, IconPreviewOff } from '@/shared/icons/lucide/icons';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../../../../../shared/ui/dialog';
import { useTranslation } from '../../../../../../shared/lib/i18n';

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

type ProfileSectionProps = {
  busy: boolean;
  profileHasPassword: boolean;
  isRenamingProfile: boolean;
  isSettingPassword: boolean;
  isChangingPassword: boolean;
  isRemovingPassword: boolean;
  renameProfileOpen: boolean;
  setRenameProfileOpen: React.Dispatch<React.SetStateAction<boolean>>;
  renameProfileValue: string;
  setRenameProfileValue: React.Dispatch<React.SetStateAction<string>>;
  canSaveRename: boolean;
  onRenameSave: () => Promise<void>;
  setPasswordOpen: boolean;
  setSetPasswordOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setPasswordValue: string;
  setSetPasswordValue: React.Dispatch<React.SetStateAction<string>>;
  setPasswordConfirm: string;
  setSetPasswordConfirm: React.Dispatch<React.SetStateAction<string>>;
  canSaveSetPassword: boolean;
  onSetPasswordSave: () => Promise<void>;
  changePasswordOpen: boolean;
  setChangePasswordOpen: React.Dispatch<React.SetStateAction<boolean>>;
  changePasswordValue: string;
  setChangePasswordValue: React.Dispatch<React.SetStateAction<string>>;
  changePasswordConfirm: string;
  setChangePasswordConfirm: React.Dispatch<React.SetStateAction<string>>;
  canSaveChangePassword: boolean;
  onChangePasswordSave: () => Promise<void>;
  removePasswordConfirmOpen: boolean;
  setRemovePasswordConfirmOpen: React.Dispatch<React.SetStateAction<boolean>>;
  onRemovePasswordConfirm: () => Promise<void>;
  tVault: TranslateFn;
  tCommon: TranslateFn;
};

export function ProfileSection({
  busy,
  profileHasPassword,
  isRenamingProfile,
  isSettingPassword,
  isChangingPassword,
  isRemovingPassword,
  renameProfileOpen,
  setRenameProfileOpen,
  renameProfileValue,
  setRenameProfileValue,
  canSaveRename,
  onRenameSave,
  setPasswordOpen,
  setSetPasswordOpen,
  setPasswordValue,
  setSetPasswordValue,
  setPasswordConfirm,
  setSetPasswordConfirm,
  canSaveSetPassword,
  onSetPasswordSave,
  changePasswordOpen,
  setChangePasswordOpen,
  changePasswordValue,
  setChangePasswordValue,
  changePasswordConfirm,
  setChangePasswordConfirm,
  canSaveChangePassword,
  onChangePasswordSave,
  removePasswordConfirmOpen,
  setRemovePasswordConfirmOpen,
  onRemovePasswordConfirm,
  tVault,
  tCommon,
}: ProfileSectionProps) {
  const { t: tTip } = useTranslation('Tooltips');
  const [isSetPasswordVisible, setIsSetPasswordVisible] = useState(false);
  const [isSetPasswordConfirmVisible, setIsSetPasswordConfirmVisible] = useState(false);
  const [isChangePasswordVisible, setIsChangePasswordVisible] = useState(false);
  const [isChangePasswordConfirmVisible, setIsChangePasswordConfirmVisible] = useState(false);

  useEffect(() => {
    if (setPasswordOpen) return;
    setIsSetPasswordVisible(false);
    setIsSetPasswordConfirmVisible(false);
  }, [setPasswordOpen]);

  useEffect(() => {
    if (changePasswordOpen) return;
    setIsChangePasswordVisible(false);
    setIsChangePasswordConfirmVisible(false);
  }, [changePasswordOpen]);

  return (
    <>
      <h3 id="profile-title" className="settings-modal-section-title">
        {tVault('settingsModal.profileTitle')}
      </h3>

      <div className="settings-profile-actions" role="group" aria-labelledby="profile-title">
        <button className="btn btn-secondary settings-profile-action" type="button" onClick={() => setRenameProfileOpen(true)} disabled={busy}>
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
            busy || isRenamingProfile || isSettingPassword || isChangingPassword || isRemovingPassword || !profileHasPassword
          }
        >
          {tVault('settingsModal.profile.removePasswordAction')}
        </button>
      </div>

      <Dialog open={renameProfileOpen} onOpenChange={(nextOpen) => (!nextOpen ? setRenameProfileOpen(false) : undefined)}>
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
              <button className="btn btn-secondary" type="button" onClick={() => setRenameProfileOpen(false)} disabled={busy || isRenamingProfile}>
                {tCommon('action.cancel')}
              </button>
            </div>

            <div className="dialog-footer-right">
              <button className="btn btn-primary" type="button" onClick={onRenameSave} disabled={busy || isRenamingProfile || !canSaveRename}>
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
              <div className="input-with-actions input-with-actions--eye-only">
                <input
                  id="set-password-input"
                  type={isSetPasswordVisible ? 'text' : 'password'}
                  value={setPasswordValue}
                  disabled={busy || isSettingPassword || profileHasPassword}
                  onChange={(event) => setSetPasswordValue(event.target.value)}
                  autoComplete="new-password"
                  className="settings-input input"
                />
                <div className="input-actions">
                  <button
                    type="button"
                    className="icon-button input-action-eye"
                    disabled={busy || isSettingPassword || profileHasPassword}
                    aria-label={isSetPasswordVisible ? tCommon('action.hidePassword') : tCommon('action.showPassword')}
                    title={isSetPasswordVisible ? tTip('action.hidePassword') : tTip('action.showPassword')}
                    onClick={() => setIsSetPasswordVisible((prev) => !prev)}
                  >
                    {isSetPasswordVisible ? <IconPreviewOff /> : <IconPreview />}
                  </button>
                </div>
              </div>
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor="set-password-confirm-input">
                {tVault('settingsModal.profile.confirmPasswordLabel')}
              </label>
              <div className="input-with-actions input-with-actions--eye-only">
                <input
                  id="set-password-confirm-input"
                  type={isSetPasswordConfirmVisible ? 'text' : 'password'}
                  value={setPasswordConfirm}
                  disabled={busy || isSettingPassword || profileHasPassword}
                  onChange={(event) => setSetPasswordConfirm(event.target.value)}
                  autoComplete="new-password"
                  className="settings-input input"
                />
                <div className="input-actions">
                  <button
                    type="button"
                    className="icon-button input-action-eye"
                    disabled={busy || isSettingPassword || profileHasPassword}
                    aria-label={isSetPasswordConfirmVisible ? tCommon('action.hidePassword') : tCommon('action.showPassword')}
                    title={isSetPasswordConfirmVisible ? tTip('action.hidePassword') : tTip('action.showPassword')}
                    onClick={() => setIsSetPasswordConfirmVisible((prev) => !prev)}
                  >
                    {isSetPasswordConfirmVisible ? <IconPreviewOff /> : <IconPreview />}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="dialog-footer--split">
            <div className="dialog-footer-left">
              <button className="btn btn-secondary" type="button" onClick={() => setSetPasswordOpen(false)} disabled={busy || isSettingPassword}>
                {tCommon('action.cancel')}
              </button>
            </div>

            <div className="dialog-footer-right">
              <button className="btn btn-primary" type="button" onClick={onSetPasswordSave} disabled={busy || isSettingPassword || !canSaveSetPassword}>
                {tVault('backup.settings.save')}
              </button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={changePasswordOpen} onOpenChange={(nextOpen) => (!nextOpen ? setChangePasswordOpen(false) : undefined)}>
        <DialogContent aria-labelledby="change-password-title">
          <DialogHeader>
            <DialogTitle id="change-password-title">{tVault('settingsModal.profile.changePasswordTitle')}</DialogTitle>
          </DialogHeader>

          <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="form-field">
              <label className="form-label" htmlFor="change-password-input">
                {tVault('settingsModal.profile.passwordLabel')}
              </label>
              <div className="input-with-actions input-with-actions--eye-only">
                <input
                  id="change-password-input"
                  type={isChangePasswordVisible ? 'text' : 'password'}
                  value={changePasswordValue}
                  disabled={busy || isChangingPassword || !profileHasPassword}
                  onChange={(event) => setChangePasswordValue(event.target.value)}
                  autoComplete="new-password"
                  className="settings-input input"
                />
                <div className="input-actions">
                  <button
                    type="button"
                    className="icon-button input-action-eye"
                    disabled={busy || isChangingPassword || !profileHasPassword}
                    aria-label={isChangePasswordVisible ? tCommon('action.hidePassword') : tCommon('action.showPassword')}
                    title={isChangePasswordVisible ? tTip('action.hidePassword') : tTip('action.showPassword')}
                    onClick={() => setIsChangePasswordVisible((prev) => !prev)}
                  >
                    {isChangePasswordVisible ? <IconPreviewOff /> : <IconPreview />}
                  </button>
                </div>
              </div>
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor="change-password-confirm-input">
                {tVault('settingsModal.profile.confirmPasswordLabel')}
              </label>
              <div className="input-with-actions input-with-actions--eye-only">
                <input
                  id="change-password-confirm-input"
                  type={isChangePasswordConfirmVisible ? 'text' : 'password'}
                  value={changePasswordConfirm}
                  disabled={busy || isChangingPassword || !profileHasPassword}
                  onChange={(event) => setChangePasswordConfirm(event.target.value)}
                  autoComplete="new-password"
                  className="settings-input input"
                />
                <div className="input-actions">
                  <button
                    type="button"
                    className="icon-button input-action-eye"
                    disabled={busy || isChangingPassword || !profileHasPassword}
                    aria-label={isChangePasswordConfirmVisible ? tCommon('action.hidePassword') : tCommon('action.showPassword')}
                    title={isChangePasswordConfirmVisible ? tTip('action.hidePassword') : tTip('action.showPassword')}
                    onClick={() => setIsChangePasswordConfirmVisible((prev) => !prev)}
                  >
                    {isChangePasswordConfirmVisible ? <IconPreviewOff /> : <IconPreview />}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="dialog-footer--split">
            <div className="dialog-footer-left">
              <button className="btn btn-secondary" type="button" onClick={() => setChangePasswordOpen(false)} disabled={busy || isChangingPassword}>
                {tCommon('action.cancel')}
              </button>
            </div>

            <div className="dialog-footer-right">
              <button className="btn btn-primary" type="button" onClick={onChangePasswordSave} disabled={busy || isChangingPassword || !canSaveChangePassword}>
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
        onConfirm={onRemovePasswordConfirm}
        onCancel={() => setRemovePasswordConfirmOpen(false)}
        confirmDisabled={busy || isRemovingPassword}
        cancelDisabled={busy || isRemovingPassword}
      />
    </>
  );
}
