# Refactor Split Changelog

## Stage 1: DataCards split
- `src/features/Vault/components/DataCards/DataCards.tsx` converted into facade/composer.
- Extracted UI parts:
  - `components/DataCardsHeader.tsx`
  - `components/DataCardContextMenu.tsx`
  - `components/DataCardList.tsx`
  - `components/DataCardListItem.tsx`
  - `components/DataCardBadges.tsx`
- Extracted dialog/UI parts:
  - `dialogs/DataCardFormDialog.tsx`
  - `dialogs/DataCardDialogActionMenu.tsx`
- Extracted pure helpers:
  - `lib/previewFieldTokens.ts`
  - `lib/buildDataCardMetaLines.ts`

## Stage 2: Details split
- `src/features/Vault/components/Details/Details.tsx` converted into facade/composer.
- Extracted hooks:
  - `hooks/useAttachmentsDrop.ts`
  - `hooks/useTotpTicker.ts`
  - `hooks/usePreviewAndCoreMenus.ts`
- Extracted menu + sections:
  - `components/FieldContextMenu.tsx`
  - `sections/MetaSection.tsx`
  - `sections/CoreFieldsSection.tsx`
  - `sections/CustomFieldsSection.tsx`
  - `sections/TwoFactorSection.tsx`
  - `sections/SeedPhraseSection.tsx`
  - `sections/AttachmentsSection.tsx`
- Extracted preview token helpers:
  - `lib/previewTokens.ts`

## Stage 3: SettingsModal split
- New module folder:
  - `src/features/Vault/components/modals/SettingsModal/`
- Legacy public import path preserved:
  - `src/features/Vault/components/modals/SettingsModal.tsx` re-exports new module.
- Extracted:
  - `components/SettingsSidebar.tsx`
  - `sections/ProfileSection.tsx`
  - `sections/SecuritySection.tsx`
  - `sections/FeaturesSection.tsx`
  - `sections/VaultsSection.tsx`
  - `sections/BackupsSection.tsx`
  - `lib/parseTrashRetentionDays.ts`
  - `lib/validateSettings.ts`

## Stage 4: useVault + Vault orchestration split
- `src/features/Vault/hooks/useVault.ts` preserved as facade export.
- Hook internals split into:
  - `src/features/Vault/hooks/vault/useVault.ts`
  - `src/features/Vault/hooks/vault/useVaultState.ts`
  - `src/features/Vault/hooks/vault/useVaultRefresh.ts`
  - `src/features/Vault/hooks/vault/useVaultCards.ts`
  - `src/features/Vault/hooks/vault/useVaultFolders.ts`
  - `src/features/Vault/hooks/vault/useVaultSettings.ts`
  - `src/features/Vault/hooks/vault/useVaultSearch.ts`
  - `src/features/Vault/hooks/vault/lib/errors.ts`
  - `src/features/Vault/hooks/vault/lib/sortVaultItems.ts`
  - `src/features/Vault/hooks/vault/lib/collectFolderSubtreeIds.ts`
- `src/features/Vault/Vault.tsx` moved to composition role with:
  - `flows/useBackupFlows.ts`
  - `flows/useSettingsFlows.ts`
  - `flows/useTrashCleanupBoot.ts`
  - `layout/VaultLayout.tsx`
  - `layout/VaultCenterPane.tsx`
  - `layout/VaultDetailsPane.tsx`
  - `layout/VaultSidebarPane.tsx`
  - `layout/VaultOverlays.tsx`

## Stage 5: CSS split
- Replaced monolith imports in `src/shared/styles/app.css`:
  - `./ui.css` -> `./ui/index.css`
  - `./screens/vault.css` -> `./screens/vault/index.css`
- Added UI style modules:
  - `src/shared/styles/ui/index.css`
  - `src/shared/styles/ui/profiles.css`
  - `src/shared/styles/ui/tiles.css`
  - `src/shared/styles/ui/empty.css`
  - `src/shared/styles/ui/buttons.css`
  - `src/shared/styles/ui/dialogs.css`
  - `src/shared/styles/ui/menus.css`
  - `src/shared/styles/ui/forms.css`
  - `src/shared/styles/ui/badges.css`
  - `src/shared/styles/ui/toasts.css`
  - `src/shared/styles/ui/misc.css`
- Added Vault screen style modules:
  - `src/shared/styles/screens/vault/index.css`
  - `src/shared/styles/screens/vault/header.css`
  - `src/shared/styles/screens/vault/sidebar.css`
  - `src/shared/styles/screens/vault/datacards.css`
  - `src/shared/styles/screens/vault/details.css`
  - `src/shared/styles/screens/vault/settings-modal.css`
  - `src/shared/styles/screens/vault/bankcards.css`
  - `src/shared/styles/screens/vault/actionmenus.css`
- Removed obsolete monolith files:
  - `src/shared/styles/ui.css`
  - `src/shared/styles/screens/vault.css`

## Stage 6: Backend Rust split
- SQLite repository split:
  - `src-tauri/src/data/sqlite/repo_impl/mod.rs`
  - `src-tauri/src/data/sqlite/repo_impl/connection.rs`
  - `src-tauri/src/data/sqlite/repo_impl/datacards.rs`
  - `src-tauri/src/data/sqlite/repo_impl/bank_cards.rs`
  - `src-tauri/src/data/sqlite/repo_impl/folders.rs`
  - `src-tauri/src/data/sqlite/repo_impl/attachments.rs`
  - `src-tauri/src/data/sqlite/repo_impl/vaults.rs`
  - `src-tauri/src/data/sqlite/repo_impl/settings.rs`
  - `src-tauri/src/data/sqlite/repo_impl/ui_prefs.rs`
  - `src-tauri/src/data/sqlite/repo_impl/trash.rs`
  - `src-tauri/src/data/sqlite/repo_impl/password_history.rs`
- Security service split:
  - `src-tauri/src/services/security_service/mod.rs`
  - `src-tauri/src/services/security_service/sqlite_image.rs`
  - `src-tauri/src/services/security_service/session.rs`
  - `src-tauri/src/services/security_service/password.rs`
  - `src-tauri/src/services/security_service/persist.rs`
  - `src-tauri/src/services/security_service/auto_lock.rs`
  - `src-tauri/src/services/security_service/errors.rs`
- Backup service split:
  - `src-tauri/src/services/backup_service/mod.rs`
  - `src-tauri/src/services/backup_service/format.rs`
  - `src-tauri/src/services/backup_service/export.rs`
  - `src-tauri/src/services/backup_service/import.rs`
  - `src-tauri/src/services/backup_service/inspect.rs`
  - `src-tauri/src/services/backup_service/auto.rs`
  - `src-tauri/src/services/backup_service/fs.rs`

## Validation
- Frontend build: `npm run build` passed.
- Rust backend check: `cargo check` in `src-tauri` passed.
