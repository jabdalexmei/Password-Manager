import React, { useMemo, useState } from 'react';
import ConfirmDialog from '../../shared/components/ConfirmDialog';
import { useTranslation } from '../../shared/lib/i18n';
import { ProfileMeta, setActiveProfile } from '../../shared/lib/tauri';
import { useStartup } from './hooks/useStartup';

type StartupProps = {
  onCreate: () => void;
  onOpen: (profile: ProfileMeta) => void;
  onBack: () => void;
};

const Startup: React.FC<StartupProps> = ({ onCreate, onOpen, onBack }) => {
  const { profiles, loading, error, removeProfile } = useStartup();
  const { t } = useTranslation('Startup');
  const [pendingDelete, setPendingDelete] = useState<ProfileMeta | null>(null);

  const content = useMemo(() => {
    if (loading) {
      return (
        <p className="muted centered">
          {t('loading')}
        </p>
      );
    }

    if (error) {
      return (
        <p className="muted centered">
          {t('error')}
        </p>
      );
    }

    if (!profiles.length) {
      return (
        <div className="empty empty--dashed">
          <p className="empty-text">{t('noProfiles')}</p>
        </div>
      );
    }

    return (
      <div className="profiles-list">
        {profiles.map((profile, index) => (
            <div className="profile-card" key={profile.id}>
              <div className="profile-meta">
                <p className="profile-name">
                  {profile.name || index + 1}
                </p>
                <p className="profile-id">
                  {t('label.profileId', { id: profile.id })}
                </p>
                <span className="badge">
                  {profile.has_password ? t('requiresPassword') : t('passwordless')}
                </span>
              </div>
            <div className="button-row">
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => setPendingDelete(profile)}
              >
                {t('delete')}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={async () => {
                  await setActiveProfile(profile.id);
                  onOpen(profile);
                }}
              >
                {t('open')}
              </button>
            </div>
          </div>
        ))}
      </div>
    );
  }, [error, loading, onOpen, profiles, t]);

  return (
    <div className="screen-shell">
      <div className="screen-card">
        <header className="startup-header">
          <h1 className="startup-title">{t('title')}</h1>
          <p className="startup-subtitle">{t('subtitle')}</p>
        </header>

        {content}

        <div className="startup-footer">
          <button type="button" className="btn btn-secondary" onClick={onBack}>
            {t('back')}
          </button>

          <button type="button" className="btn btn-primary" onClick={onCreate}>
            {t('create')}
          </button>
        </div>
        <p className="startup-footnote">{t('footnote')}</p>
      </div>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={t('confirmDeleteTitle')}
        description={t('confirmDelete')}
        cancelLabel={t('cancel')}
        confirmLabel={t('delete')}
        onCancel={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (pendingDelete) {
            await removeProfile(pendingDelete.id);
          }
          setPendingDelete(null);
        }}
      />

    </div>
  );
};

export default Startup;
