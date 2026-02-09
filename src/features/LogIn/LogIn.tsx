import React, { FormEvent, useEffect } from 'react';
import { useTranslation } from '../../shared/lib/i18n';
import { useLogIn } from './hooks/useLogIn';

type LogInProps = {
  profileId: string;
  profileName: string;
  hasPassword: boolean;
  onBack: () => void;
  onSuccess: () => void;
};

const LogIn: React.FC<LogInProps> = ({
  profileId,
  profileName,
  hasPassword,
  onBack,
  onSuccess,
}) => {
  const { t } = useTranslation('LogIn');
  const { password, setPassword, submit, error } = useLogIn(
    profileId,
    onSuccess,
  );

  useEffect(() => {
    if (!hasPassword) {
      onBack();
    }
  }, [hasPassword, onBack]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit();
  };

  if (!hasPassword) {
    return null;
  }

  return (
    <div className="screen-shell">
      <div className="screen-card screen-card--borderless login-card">
        <header className="login-header">
          <h1 className="login-title">{t('title')}</h1>
          <p className="login-subtitle">{t('subtitle')}</p>
        </header>

        <div className="auth-body">
          <div className="auth-content">
            <div className="auth-panel">
              <div className="profile-card login-selected-profile">
                <div className="profile-meta">
                  <p className="muted" style={{ marginBottom: 4 }}>
                    {t('selectedProfile')}
                  </p>
                  <p className="profile-name">
                    {profileName || t('unnamedProfile')}
                  </p>
                  <p className="profile-id">
                    {t('label.profileId', { id: profileId })}
                  </p>
                </div>
              </div>

              <form
                className="login-form form-grid"
                onSubmit={handleSubmit}
                autoComplete="off"
                style={{ marginTop: 14 }}
              >
                <div className="form-field">
                  <label className="form-label" htmlFor="login-password">
                    {t('passwordLabel')}
                  </label>
                  <input
                    id="login-password"
                    type="password"
                    className="input"
                    name="pm-login-password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t('passwordPlaceholder')}
                  />
                </div>

                {error && <div className="form-error">{t('error')}</div>}

                <div className="auth-footer">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={onBack}
                  >
                    {t('back')}
                  </button>
                  <button type="submit" className="btn btn-primary">
                    {t('submit')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LogIn;
