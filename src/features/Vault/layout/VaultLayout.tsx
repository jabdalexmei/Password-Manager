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
        <section className="vault-datacards">{centerPane}</section>
        <section className="vault-details">{detailsPane}</section>
      </div>

      {overlays}
    </div>
  );
}
