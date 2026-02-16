import React, { FormEvent, useState } from 'react';
import { IconPreview, IconPreviewOff } from '@/shared/icons/lucide/icons';
import { useTranslation } from '../../shared/lib/i18n';
import { ProfileMeta } from '../../shared/lib/tauri';
import { useProfileCreate } from './hooks/useProfileCreate';

type ProfileCreateProps = {
  onCreated: () => void;
  onProfileCreated: (profile: ProfileMeta) => void;
  onBack: () => void;
};

const ProfileCreate: React.FC<ProfileCreateProps> = ({ onCreated, onProfileCreated, onBack }) => {
  const { t } = useTranslation('ProfileCreate');
  const { t: tCommon } = useTranslation('Common');
  const { name, password, confirmPassword, setName, setPassword, setConfirmPassword, submit, error } = useProfileCreate(
    (profile) => {
      onProfileCreated(profile);
      onCreated();
    }
  );
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isConfirmPasswordVisible, setIsConfirmPasswordVisible] = useState(false);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit();
  };

  return (
    <div className="screen-shell">
      <div className="screen-card profile-create-card">
        <header className="profile-create-header">
          <h1 className="profile-create-title">{t('title')}</h1>
          <p className="profile-create-subtitle">{t('subtitle')}</p>
        </header>

        {/* Full-width panel like "Select profile" (no narrow centered column) */}
        <form className="profile-create-form" onSubmit={handleSubmit} autoComplete="off">
          <div className="profile-create-panel form-grid">
            <div className="form-field">
              <label className="form-label" htmlFor="profile-name">
                {t('name')}
              </label>
              <input
                id="profile-name"
                name="profile_display_name"
                autoComplete="off"
                aria-autocomplete="none"
                list="autocompleteOff"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('namePlaceholder')}
              />
              <datalist id="autocompleteOff" />
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor="profile-password">
                {t('passwordLabel')}
              </label>
              <div className="input-with-actions">
                <input
                  id="profile-password"
                  name="profile_master_password"
                  className="input"
                  type={isPasswordVisible ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('passwordPlaceholder')}
                />
                <div className="input-actions">
                  <button
                    type="button"
                    className="icon-button input-action-eye"
                    aria-label={isPasswordVisible ? tCommon('action.hidePassword') : tCommon('action.showPassword')}
                    title={isPasswordVisible ? tCommon('action.hidePassword') : tCommon('action.showPassword')}
                    onClick={() => setIsPasswordVisible((prev) => !prev)}
                  >
                    {isPasswordVisible ? <IconPreviewOff /> : <IconPreview />}
                  </button>
                </div>
              </div>
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor="profile-password-confirm">
                {t('confirmPassword')}
              </label>
              <div className="input-with-actions">
                <input
                  id="profile-password-confirm"
                  name="profile_master_password_confirm"
                  className="input"
                  type={isConfirmPasswordVisible ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder={t('confirmPasswordPlaceholder')}
                />
                <div className="input-actions">
                  <button
                    type="button"
                    className="icon-button input-action-eye"
                    aria-label={isConfirmPasswordVisible ? tCommon('action.hidePassword') : tCommon('action.showPassword')}
                    title={isConfirmPasswordVisible ? tCommon('action.hidePassword') : tCommon('action.showPassword')}
                    onClick={() => setIsConfirmPasswordVisible((prev) => !prev)}
                  >
                    {isConfirmPasswordVisible ? <IconPreviewOff /> : <IconPreview />}
                  </button>
                </div>
              </div>
            </div>

            {error && <div className="form-error">{t(error)}</div>}
          </div>

          <div className="profile-create-footer">
            <button type="button" className="btn btn-secondary" onClick={onBack}>
              {t('back')}
            </button>

            <button type="submit" className="btn btn-primary">
              {t('submit')}
            </button>
          </div>
        </form>

        <p className="profile-create-footnote">{t('footnote')}</p>
      </div>
    </div>
  );
};

export default ProfileCreate;
