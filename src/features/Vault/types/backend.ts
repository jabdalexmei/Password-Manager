export type BackendFolder = {
  id: string;
  name: string;
  parent_id: string | null;
  is_system: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type BackendVault = {
  id: string;
  name: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

export type BackendCustomFieldType = "text" | "secret" | "url" | "number" | "date";

export type BackendCustomField = {
  key: string;
  value: string;
  type: BackendCustomFieldType;
};

export type BackendPasswordHistoryRow = {
  id: string;
  datacard_id: string;
  password_value: string;
  created_at: string;
};

export type BackendDataCard = {
  id: string;
  folder_id: string | null;
  title: string;
  url: string | null;
  email: string | null;
  recovery_email: string | null;
  username: string | null;
  mobile_phone: string | null;
  note: string | null;
  is_favorite: boolean;
  tags: string[];
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  deleted_at: string | null;
  password: string | null;
  totp_uri: string | null;
  seed_phrase: string | null;
  seed_phrase_word_count: number | null;
  custom_fields: BackendCustomField[];
  preview_fields: string[];
};

export type BackendDataCardSummary = {
  id: string;
  folder_id: string | null;
  title: string;
  url: string | null;
  email: string | null;
  recovery_email: string | null;
  username: string | null;
  mobile_phone: string | null;
  note: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  deleted_at: string | null;
  is_favorite: boolean;
  has_totp: boolean;
  has_seed_phrase: boolean;
  has_phone: boolean;
  has_note: boolean;
  has_attachments: boolean;
  preview_fields: string[];

  // Required so custom preview fields can render in the list view
  // without waiting for a full card fetch.
  custom_fields: BackendCustomField[];
};

export type BackendCreateDataCardInput = {
  folder_id: string | null;
  title: string;
  url: string | null;
  email: string | null;
  recovery_email: string | null;
  username: string | null;
  mobile_phone: string | null;
  note: string | null;
  tags: string[];
  password: string | null;
  totp_uri: string | null;
  seed_phrase: string | null;
  seed_phrase_word_count: number | null;
  custom_fields: BackendCustomField[];
};

export type BackendUpdateDataCardInput = BackendCreateDataCardInput & {
  id: string;
};

export type BackendBankCardItem = {
  id: string;
  folder_id: string | null;
  title: string;
  bank_name: string | null;
  holder: string | null;
  number: string | null;
  expiry_mm_yy: string | null;
  cvc: string | null;
  note: string | null;
  tags: string[];
  preview_fields: { fields: string[]; card_number_mode: string | null };
  is_favorite: boolean;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  deleted_at: string | null;
};

export type BackendBankCardSummary = {
  id: string;
  folder_id: string | null;
  title: string;
  bank_name: string | null;
  holder: string | null;
  number: string | null;
  note: string | null;
  tags: string[];
  preview_fields: { fields: string[]; card_number_mode: string | null };
  is_favorite: boolean;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  deleted_at: string | null;
};

export type BackendCreateBankCardInput = {
  folder_id: string | null;
  title: string;
  bank_name: string | null;
  holder: string | null;
  number: string | null;
  expiry_mm_yy: string | null;
  cvc: string | null;
  note: string | null;
  tags: string[];
};

export type BackendUpdateBankCardInput = BackendCreateBankCardInput & {
  id: string;
};

export type BackendAttachmentMeta = {
  id: string;
  datacard_id: string;
  file_name: string;
  mime_type: string | null;
  byte_size: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type BackendAttachmentPreviewPayload = {
  attachment_id: string;
  file_name: string;
  mime_type: string;
  byte_size: number;
  base64_data: string;
};

export type BackendUserSettings = {
  auto_hide_secret_timeout_seconds: number;
  auto_lock_enabled: boolean;
  auto_lock_timeout: number;
  reveal_requires_confirmation: boolean;
  clipboard_auto_clear_enabled: boolean;
  clipboard_clear_timeout_seconds: number;
  soft_delete_enabled: boolean;
  trash_retention_days: number;
  backups_enabled: boolean;
  auto_backup_interval_minutes: number;
  backup_max_copies: number;
  backup_frequency: "daily" | "weekly" | "monthly";
  default_sort_field: "created_at" | "updated_at" | "title";
  default_sort_direction: "ASC" | "DESC";
  mask_password_by_default: boolean;
  multiply_vaults_enabled: boolean;
  active_vault_id: string;
};
