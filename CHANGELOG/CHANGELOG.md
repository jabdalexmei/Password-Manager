# Changelog

## 2026-02-10
- Added full Russian locale support (`ru`) for all UI namespaces.
- Reworked `src/shared/lib/i18n.ts` to support runtime language switching (`en`/`ru`) with:
  - localStorage persistence (`uiLanguage`)
  - startup language restore
  - system-language fallback (`ru*` -> `ru`, otherwise `en`)
  - per-key fallback from selected language to English.
- Added global i18n provider wiring in `src/app/main.tsx`.
- Updated Settings navigation and sections:
  - added new `General` section with language selector
  - renamed internal/public settings section id and keys from `options` to `features`
  - fixed sidebar title to `Settings` (`settingsModal.sidebarTitle`).
- Updated Settings UI structure:
  - section order: General, Profile, Security, Features, Vaults, Backups.
- Added Russian locale files:
  - `src/i18n/locales/ru/Common.json`
  - `src/i18n/locales/ru/Tooltips.json`
  - `src/i18n/locales/ru/Startup.json`
  - `src/i18n/locales/ru/ProfileCreate.json`
  - `src/i18n/locales/ru/LogIn.json`
  - `src/i18n/locales/ru/Vault.json`
  - `src/i18n/locales/ru/DataCards.json`
  - `src/i18n/locales/ru/BankCards.json`
  - `src/i18n/locales/ru/Search.json`
  - `src/i18n/locales/ru/Folders.json`
  - `src/i18n/locales/ru/Details.json`
  - `src/i18n/locales/ru/Workspace.json`
