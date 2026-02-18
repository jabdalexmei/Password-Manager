import React from 'react';

type VaultLayoutProps = {
  header: React.ReactNode;
  sidebar: React.ReactNode;
  centerPane: React.ReactNode;
  detailsPane: React.ReactNode;
  overlays?: React.ReactNode;
};

export function VaultLayout({ header, sidebar, centerPane, detailsPane, overlays }: VaultLayoutProps) {
  return (
    <div className="vault-shell">
      {header}

      <div className="vault-body">
        <aside className="vault-sidebar">{sidebar}</aside>
        <section className="vault-allcards">{centerPane}</section>
        <section className="vault-information">{detailsPane}</section>
      </div>

      {overlays}
    </div>
  );
}
