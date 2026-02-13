import type { BankCardPreviewField } from "../lib/bankcardPreviewFields";

export type Folder = {
  id: string;
  name: string;
  parentId: string | null;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type VaultItem = {
  id: string;
  name: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CustomFieldType = "text" | "secret" | "url" | "number" | "date";

export type CustomField = {
  key: string;
  value: string;
  type: CustomFieldType;
};

export type DataCard = {
  id: string;
  folderId: string | null;
  title: string;
  url: string | null;
  email: string | null;
  recoveryEmail: string | null;
  username: string | null;
  mobilePhone: string | null;
  note: string | null;
  isFavorite: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  deletedAt: string | null;
  password: string | null;
  totpUri: string | null;
  seedPhrase: string | null;
  seedPhraseWordCount: number | null;
  customFields: CustomField[];
  previewFields: string[];
};

export type PasswordHistoryEntry = {
  id: string;
  datacardId: string;
  passwordValue: string;
  createdAt: string;
};

export type Attachment = {
  id: string;
  datacardId: string;
  fileName: string;
  mimeType: string | null;
  byteSize: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type DataCardSummary = DataCard & {
  updatedAtLabel: string;
  createdAtLabel: string;
  metaLine: string;
  hasTotp: boolean;
  hasSeedPhrase: boolean;
  hasRecoveryEmail: boolean;
  hasPhone: boolean;
  hasNotes: boolean;
  hasAttachments: boolean;
};

export type CreateDataCardInput = {
  folderId: string | null;
  title: string;
  url?: string | null;
  email?: string | null;
  recoveryEmail?: string | null;
  username?: string | null;
  mobilePhone?: string | null;
  note?: string | null;
  tags?: string[];
  password?: string | null;
  totpUri?: string | null;
  seedPhrase?: string | null;
  seedPhraseWordCount?: number | null;
  customFields?: CustomField[];
};

export type UpdateDataCardInput = CreateDataCardInput & {
  id: string;
};

export type BankCardItem = {
  id: string;
  folderId: string | null;
  title: string;
  bankName: string | null;
  holder: string | null;
  number: string | null;
  expiryMmYy: string | null;
  cvc: string | null;
  note: string | null;
  tags: string[];
  previewFields: { fields: BankCardPreviewField[]; cardNumberMode: 'full' | 'last_four' | null };
  isFavorite: boolean;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  deletedAt: string | null;
};

export type BankCardSummary = BankCardItem & {
  updatedAtLabel: string;
  createdAtLabel: string;
  metaLine: string;
};

export type CreateBankCardInput = {
  folderId?: string | null;
  title: string;
  bankName?: string | null;
  holder?: string | null;
  number?: string | null;
  expiryMmYy?: string | null;
  cvc?: string | null;
  note?: string | null;
  tags?: string[];
};

export type UpdateBankCardInput = CreateBankCardInput & {
  id: string;
};
