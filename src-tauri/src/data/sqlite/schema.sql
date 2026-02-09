PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS vaults (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vaults_unique_name
ON vaults(name);

INSERT OR IGNORE INTO vaults (id, name, is_default, created_at, updated_at)
VALUES ('default', 'Default vault', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS folders (
  id         TEXT PRIMARY KEY,
  vault_id   TEXT NOT NULL DEFAULT 'default',
  name       TEXT NOT NULL,
  parent_id  TEXT NULL,
  is_system  INTEGER NOT NULL DEFAULT 0,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_folders_unique_name
ON folders(vault_id, parent_id, name)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_folders_parent
ON folders(parent_id);

CREATE INDEX IF NOT EXISTS idx_folders_vault
ON folders(vault_id);

CREATE TABLE IF NOT EXISTS datacards (
  id           TEXT PRIMARY KEY,
  vault_id     TEXT NOT NULL DEFAULT 'default',
  folder_id    TEXT NULL,

  title        TEXT,
  url          TEXT NULL,
  email        TEXT NULL,
  recovery_email TEXT NULL,
  username     TEXT NULL,
  mobile_phone TEXT NULL,
  note         TEXT NULL,

  is_favorite  INTEGER NOT NULL DEFAULT 0,

  tags_json           TEXT NOT NULL DEFAULT '[]',
  password_value      TEXT NULL,
  totp_uri            TEXT NULL,
  seed_phrase_value   TEXT NULL,
  seed_phrase_word_count   INTEGER NULL,
  custom_fields_json  TEXT NOT NULL DEFAULT '[]',
  preview_fields_json TEXT NOT NULL DEFAULT '[]',

  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  archived_at  TEXT NULL,
  deleted_at   TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_datacards_folder
ON datacards(folder_id);

CREATE INDEX IF NOT EXISTS idx_datacards_vault
ON datacards(vault_id);

CREATE INDEX IF NOT EXISTS idx_datacards_archived
ON datacards(archived_at);

CREATE INDEX IF NOT EXISTS idx_datacards_deleted
ON datacards(deleted_at);

CREATE TABLE IF NOT EXISTS datacard_password_history (
  id TEXT PRIMARY KEY NOT NULL,
  datacard_id TEXT NOT NULL,
  password_value TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(datacard_id) REFERENCES datacards(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_datacard_password_history_datacard_id
  ON datacard_password_history(datacard_id);

CREATE TABLE IF NOT EXISTS attachments (
  id          TEXT PRIMARY KEY,
  datacard_id TEXT NOT NULL,

  file_name   TEXT NOT NULL,
  mime_type   TEXT NULL,
  byte_size   INTEGER NOT NULL,

  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT NULL,

  FOREIGN KEY(datacard_id) REFERENCES datacards(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_attachments_datacard
ON attachments(datacard_id);

CREATE INDEX IF NOT EXISTS idx_attachments_deleted
ON attachments(deleted_at);

CREATE TABLE IF NOT EXISTS bank_cards (
  id TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL DEFAULT 'default',
  folder_id TEXT NULL,

  title TEXT NOT NULL,
  bank_name TEXT,
  holder TEXT,
  number TEXT,
  expiry_mm_yy TEXT,
  cvc TEXT,
  note TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  preview_fields_json TEXT NOT NULL DEFAULT '{}',
  is_favorite INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_bank_cards_archived_at ON bank_cards (archived_at);
CREATE INDEX IF NOT EXISTS idx_bank_cards_deleted_at ON bank_cards (deleted_at);
CREATE INDEX IF NOT EXISTS idx_bank_cards_is_favorite ON bank_cards (is_favorite);
CREATE INDEX IF NOT EXISTS idx_bank_cards_folder ON bank_cards (folder_id);
CREATE INDEX IF NOT EXISTS idx_bank_cards_vault ON bank_cards (vault_id);

-- UI preferences for frontend-only settings that should live with the vault DB.
CREATE TABLE IF NOT EXISTS ui_preferences (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
