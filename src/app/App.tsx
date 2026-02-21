import React, { Suspense, useCallback, useMemo, useState } from 'react';
import { ToasterProvider } from '../shared/components/Toaster';
import { useTranslation } from '../shared/lib/i18n';
import { ProfileMeta, loginVault, setActiveProfile } from '../shared/lib/tauri';

type View = 'workspace' | 'startup' | 'create' | 'login' | 'vault';

const Workspace = React.lazy(() => import('../features/Workspace/Workspace'));
const Startup = React.lazy(() => import('../features/Startup/Startup'));
const ProfileCreate = React.lazy(() => import('../features/ProfileCreate/ProfileCreate'));
const LogIn = React.lazy(() => import('../features/LogIn/LogIn'));
const Vault = React.lazy(() => import('../features/Vault/Vault'));

const App: React.FC = () => {
  const { t } = useTranslation('Common');
  const [view, setView] = useState<View>('workspace');
  const [activeProfile, setProfile] = useState<ProfileMeta | null>(null);

  const openProfile = useCallback(async (profile: ProfileMeta) => {
    setProfile(profile);
    await setActiveProfile(profile.id);
    if (profile.has_password) {
      setView('login');
    } else {
      await loginVault(profile.id, undefined);
      setView('vault');
    }
  }, []);

  const handleProfileCreated = useCallback(
    async (profile: ProfileMeta) => {
      await openProfile(profile);
    },
    [openProfile]
  );

  const content = useMemo(() => {
    switch (view) {
      case 'startup':
        return (
          <Startup
            onCreate={() => setView('create')}
            onOpen={openProfile}
            onBack={() => {
              setProfile(null);
              setView('workspace');
            }}
          />
        );
      case 'workspace':
        return (
          <Workspace
            onWorkspaceReady={() => {
              setProfile(null);
              setView('startup');
            }}
          />
        );
      case 'create':
        return (
          <ProfileCreate
            onCreated={() => setView('startup')}
            onBack={() => setView('startup')}
            onProfileCreated={handleProfileCreated}
          />
        );
      case 'login':
        return activeProfile ? (
          <LogIn
            profileId={activeProfile.id}
            profileName={activeProfile.name}
            hasPassword={activeProfile.has_password}
            onBack={() => setView('startup')}
            onSuccess={() => setView('vault')}
          />
        ) : null;
      case 'vault':
        return activeProfile ? (
          <Vault
            profileId={activeProfile.id}
            profileName={activeProfile.name}
            isPasswordless={!activeProfile.has_password}
            onProfileRenamed={(name) => setProfile((p) => (p ? { ...p, name } : p))}
            onProfileUpdated={(next) => setProfile((p) => (p && p.id === next.id ? next : p))}
            onLocked={() => {
              if (activeProfile.has_password) {
                setView('login');
              } else {
                setProfile(null);
                setView('startup');
              }
            }}
          />
        ) : null;
      default:
        return null;
    }
  }, [activeProfile, handleProfileCreated, openProfile, view]);

  return (
    <ToasterProvider>
      <Suspense fallback={<p className="muted centered" aria-busy="true">{t('label.loading')}</p>}>
        {content}
      </Suspense>
    </ToasterProvider>
  );
};

export default App;
