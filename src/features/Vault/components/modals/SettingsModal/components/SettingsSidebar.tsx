import React from 'react';

export type SettingsSection = 'general' | 'profile' | 'security' | 'features' | 'vaults' | 'backups';

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

type SettingsSidebarProps = {
  activeSection: SettingsSection;
  onChangeSection: (section: SettingsSection) => void;
  tVault: TranslateFn;
};

export function SettingsSidebar({ activeSection, onChangeSection, tVault }: SettingsSidebarProps) {
  return (
    <aside className="settings-sidebar" aria-label={tVault('settingsModal.sidebarTitle')}>
      <div className="settings-sidebar-title">{tVault('settingsModal.sidebarTitle')}</div>
      <nav className="settings-sidebar-nav" aria-label={tVault('settingsModal.sidebarTitle')}>
        <button
          type="button"
          className="settings-nav-item"
          data-active={activeSection === 'general' ? 'true' : 'false'}
          onClick={() => onChangeSection('general')}
        >
          {tVault('settingsModal.generalTitle')}
        </button>
        <button
          type="button"
          className="settings-nav-item"
          data-active={activeSection === 'profile' ? 'true' : 'false'}
          onClick={() => onChangeSection('profile')}
        >
          {tVault('settingsModal.profileTitle')}
        </button>
        <button
          type="button"
          className="settings-nav-item"
          data-active={activeSection === 'security' ? 'true' : 'false'}
          onClick={() => onChangeSection('security')}
        >
          {tVault('settingsModal.securityTitle')}
        </button>
        <button
          type="button"
          className="settings-nav-item"
          data-active={activeSection === 'features' ? 'true' : 'false'}
          onClick={() => onChangeSection('features')}
        >
          {tVault('settingsModal.features.sectionTitle')}
        </button>
        <button
          type="button"
          className="settings-nav-item"
          data-active={activeSection === 'vaults' ? 'true' : 'false'}
          onClick={() => onChangeSection('vaults')}
        >
          {tVault('settingsModal.vaultsTitle')}
        </button>
        <button
          type="button"
          className="settings-nav-item"
          data-active={activeSection === 'backups' ? 'true' : 'false'}
          onClick={() => onChangeSection('backups')}
        >
          {tVault('backup.settings.title')}
        </button>
      </nav>
    </aside>
  );
}
