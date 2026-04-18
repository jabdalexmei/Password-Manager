import { invoke } from '@tauri-apps/api/core';
// Tauri convention: Rust snake_case command args are passed as camelCase from the frontend by default.
// Do not send snake_case keys unless the Rust command uses #[tauri::command(rename_all = "snake_case")].
import {
  BackendBankCardItem,
  BackendBankCardSummary,
  BackendCreateBankCardInput,
  BackendCreateDataCardInput,
  BackendDataCard,
  BackendDataCardSummary,
  BackendFolder,
  BackendAttachmentMeta,
  BackendUpdateBankCardInput,
  BackendUpdateDataCardInput,
  BackendUserSettings,
  BackendVault,
  BackendAttachmentPreviewPayload,
  BackendPasswordHistoryRow,
  BackendTrashCleanupResult,
} from '../types/backend';
import { mapPasswordHistoryFromBackend } from '../types/mappers';
import { PasswordHistoryEntry } from '../types/ui';

export async function listFolders(): Promise<BackendFolder[]> {
  return invoke('list_folders');
}

export async function listVaults(): Promise<BackendVault[]> {
  return invoke('list_vaults');
}

export async function createVault(name: string): Promise<BackendVault> {
  return invoke('create_vault', { name });
}

export async function renameVault(id: string, name: string): Promise<boolean> {
  return invoke('rename_vault', { id, name });
}

export async function deleteVault(id: string): Promise<boolean> {
  return invoke('delete_vault', { id });
}

export async function setDefaultVault(id: string): Promise<boolean> {
  return invoke('set_default_vault', { id });
}

export async function setActiveVault(id: string): Promise<boolean> {
  return invoke('set_active_vault', { id });
}

export async function createFolder(input: { name: string; parent_id: string | null }): Promise<BackendFolder> {
  return invoke('create_folder', { input });
}

export async function renameFolder(input: { id: string; name: string }): Promise<boolean> {
  return invoke('rename_folder', { input });
}

export async function deleteFolderOnly(id: string): Promise<boolean> {
  return invoke('delete_folder_only', { id });
}

export async function deleteFolderAndCards(id: string): Promise<boolean> {
  return invoke('delete_folder_and_cards', { id });
}

export async function listDataCardSummaries(): Promise<BackendDataCardSummary[]> {
  return invoke('list_datacards_summary_command');
}

export async function listDeletedDataCardSummaries(): Promise<BackendDataCardSummary[]> {
  return invoke('list_deleted_datacards_summary_command');
}

export async function listBankCardSummaries(): Promise<BackendBankCardSummary[]> {
  return invoke('list_bank_cards_summary_command');
}

export async function listDeletedBankCardSummaries(): Promise<BackendBankCardSummary[]> {
  return invoke('list_deleted_bank_cards_summary_command');
}

export async function getBankCard(id: string): Promise<BackendBankCardItem> {
  return invoke('get_bank_card', { id });
}

export async function createBankCard(input: BackendCreateBankCardInput): Promise<BackendBankCardItem> {
  return invoke('create_bank_card', { input });
}

export async function updateBankCard(input: BackendUpdateBankCardInput): Promise<boolean> {
  return invoke('update_bank_card', { input });
}

export async function setBankCardFavorite(input: { id: string; is_favorite: boolean }): Promise<boolean> {
  return invoke('set_bank_card_favorite', { input });
}

export async function setBankCardArchived(input: { id: string; is_archived: boolean }): Promise<boolean> {
  return invoke('set_bankcard_archived', { input });
}

export async function searchDataCards(query: string): Promise<string[]> {
  return invoke('search_datacards', { query });
}

export async function searchBankCards(query: string): Promise<string[]> {
  return invoke('search_bank_cards', { query });
}

export async function deleteBankCard(id: string): Promise<boolean> {
  return invoke('delete_bank_card', { id });
}

export async function restoreBankCard(id: string): Promise<boolean> {
  return invoke('restore_bank_card', { id });
}

export async function purgeBankCard(id: string): Promise<boolean> {
  return invoke('purge_bank_card', { id });
}

export async function restoreAllDeletedBankCards(): Promise<boolean> {
  return invoke('restore_all_deleted_bank_cards');
}

export async function purgeAllDeletedBankCards(): Promise<boolean> {
  return invoke('purge_all_deleted_bank_cards');
}

export async function getDataCard(id: string): Promise<BackendDataCard> {
  return invoke('get_datacard', { id });
}

export async function createDataCard(input: BackendCreateDataCardInput): Promise<BackendDataCard> {
  return invoke('create_datacard', { input });
}

export async function updateDataCard(input: BackendUpdateDataCardInput): Promise<boolean> {
  return invoke('update_datacard', { input });
}

export async function setDataCardFavorite(input: { id: string; is_favorite: boolean }): Promise<boolean> {
  return invoke('set_datacard_favorite', { input });
}

export async function setDataCardArchived(input: { id: string; is_archived: boolean }): Promise<boolean> {
  return invoke('set_datacard_archived', { input });
}

export async function moveDataCardToFolder(input: { id: string; folder_id: string | null }): Promise<boolean> {
  return invoke('move_datacard_to_folder', { input });
}

export async function deleteDataCard(id: string): Promise<boolean> {
  return invoke('delete_datacard', { id });
}

export async function restoreDataCard(id: string): Promise<boolean> {
  return invoke('restore_datacard', { id });
}

export async function purgeDataCard(id: string): Promise<boolean> {
  return invoke('purge_datacard', { id });
}

export async function restoreAllDeletedDataCards(): Promise<boolean> {
  return invoke('restore_all_deleted_datacards');
}

export async function purgeAllDeletedDataCards(): Promise<boolean> {
  return invoke('purge_all_deleted_datacards');
}

export async function setDataCardPreviewFieldsForCard(id: string, fields: string[]): Promise<boolean> {
  return invoke('set_datacard_preview_fields_for_card', { id, fields });
}

export async function setBankCardPreviewFieldsForCard(
  id: string,
  previewFields: { fields: string[]; card_number_mode: string | null }
): Promise<boolean> {
  // Tauri command args are camelCased (preview_fields -> previewFields)
  return invoke('set_bankcard_preview_fields_for_card', { id, previewFields });
}

export async function getSettings(): Promise<BackendUserSettings> {
  return invoke('get_settings');
}

export async function updateSettings(settings: BackendUserSettings): Promise<boolean> {
  return invoke('update_settings', { settings });
}

export async function runTrashAutoCleanupIfEnabled(): Promise<BackendTrashCleanupResult> {
  return invoke('run_trash_auto_cleanup_if_enabled');
}

export async function createBackup(
  useDefaultPath: boolean,
  suggestedFileName?: string
): Promise<string | null> {
  if (useDefaultPath) {
    return invoke('backup_create', { destinationPath: null, useDefaultPath: true });
  }
  return invoke('backup_create_via_dialog', { suggestedFileName: suggestedFileName ?? null });
}

export type BackupPickPayloadDto = {
  token: string;
  fileName: string;
  byteSize: number;
  inspect: { profile_id: string; profile_name: string; vault_mode: string; will_overwrite: boolean };
};

type BackendBackupPickPayload = {
  token: string;
  file_name: string;
  byte_size: number;
  inspect: BackupPickPayloadDto['inspect'];
};

export async function backupPickFile(): Promise<BackupPickPayloadDto | null> {
  const payload = await invoke<BackendBackupPickPayload | null>('backup_pick_file');
  if (!payload) return null;
  return {
    token: payload.token,
    fileName: payload.file_name,
    byteSize: payload.byte_size,
    inspect: payload.inspect,
  };
}

export async function backupDiscardPick(token: string): Promise<void> {
  await invoke('backup_discard_pick', { token });
}

export async function restoreBackupWorkflowFromPick(token: string): Promise<boolean> {
  return invoke('backup_restore_workflow_from_pick', { token });
}

export type LegacyImportInspectDto = {
  total_rows: number;
  ready_rows: number;
  skipped_rows: number;
  unknown_folder_rows: number;
  missing_title_rows: number;
};

type BackendLegacyImportPickPayload = {
  token: string;
  file_name: string;
  byte_size: number;
  inspect: LegacyImportInspectDto;
};

export type LegacyImportPickPayloadDto = {
  token: string;
  fileName: string;
  byteSize: number;
  inspect: LegacyImportInspectDto;
};

export type LegacyImportErrorRowDto = {
  row_number: number;
  title: string;
  code: string;
  message: string;
};

type BackendLegacyImportResult = {
  imported_count: number;
  skipped_count: number;
  error_count: number;
  report_path: string;
  errors: LegacyImportErrorRowDto[];
};

export type LegacyImportResultDto = {
  importedCount: number;
  skippedCount: number;
  errorCount: number;
  reportPath: string;
  errors: LegacyImportErrorRowDto[];
};

export async function legacyImportPickCsv(): Promise<LegacyImportPickPayloadDto | null> {
  const payload = await invoke<BackendLegacyImportPickPayload | null>('legacy_import_pick_csv');
  if (!payload) return null;
  return {
    token: payload.token,
    fileName: payload.file_name,
    byteSize: payload.byte_size,
    inspect: payload.inspect,
  };
}

export async function legacyImportDiscardPick(token: string): Promise<void> {
  await invoke('legacy_import_discard_pick', { token });
}

export async function legacyImportFromPick(token: string): Promise<LegacyImportResultDto> {
  const result = await invoke<BackendLegacyImportResult>('legacy_import_from_pick', { token });
  return {
    importedCount: result.imported_count,
    skippedCount: result.skipped_count,
    errorCount: result.error_count,
    reportPath: result.report_path,
    errors: result.errors,
  };
}

export async function listBackups(): Promise<
  Array<{ id: string; created_at_utc: string; path: string; bytes: number }>
> {
  return invoke('backup_list');
}

export async function createBackupIfDueAuto(): Promise<string | null> {
  return invoke('backup_create_if_due_auto');
}

export async function getPasswordHistory(datacardId: string): Promise<PasswordHistoryEntry[]> {
  const rows = await invoke<BackendPasswordHistoryRow[]>('get_datacard_password_history', {
    datacardId,
  });

  return rows.map(mapPasswordHistoryFromBackend);
}

export async function clearPasswordHistory(datacardId: string): Promise<void> {
  await invoke('clear_datacard_password_history', { datacardId });
}

export async function deletePasswordHistoryEntry(entryId: string): Promise<void> {
  await invoke('delete_datacard_password_history_entry', { entryId });
}

export async function listAttachments(datacardId: string): Promise<BackendAttachmentMeta[]> {
  return invoke('list_attachments', { datacardId });
}

export type AttachmentPickFileDto = {
  id: string;
  fileName: string;
  byteSize: number;
};

export type AttachmentPickPayloadDto = {
  token: string;
  files: AttachmentPickFileDto[];
};

type BackendAttachmentPickFile = { id: string; file_name: string; byte_size: number };
type BackendAttachmentPickPayload = { token: string; files: BackendAttachmentPickFile[] };

export async function attachmentsPickFiles(): Promise<AttachmentPickPayloadDto | null> {
  const payload = await invoke<BackendAttachmentPickPayload | null>('attachments_pick_files');
  if (!payload) return null;
  return {
    token: payload.token,
    files: payload.files.map((f) => ({
      id: f.id,
      fileName: f.file_name,
      byteSize: f.byte_size,
    })),
  };
}

export async function attachmentsDiscardPick(token: string): Promise<void> {
  await invoke('attachments_discard_pick', { token });
}

export async function addAttachmentsFromPick(
  datacardId: string,
  token: string,
  fileIds?: string[]
): Promise<BackendAttachmentMeta[]> {
  return invoke('add_attachments_from_pick', { datacardId, token, fileIds: fileIds ?? null });
}

export async function addAttachmentsViaDialog(datacardId: string): Promise<BackendAttachmentMeta[]> {
  return invoke('add_attachments_via_dialog', { datacardId });
}

export async function removeAttachment(attachmentId: string): Promise<void> {
  return invoke('remove_attachment', { attachmentId });
}

export async function purgeAttachment(attachmentId: string): Promise<void> {
  return invoke('purge_attachment', { attachmentId });
}

export async function saveAttachmentViaDialog(attachmentId: string): Promise<boolean> {
  return invoke('save_attachment_via_dialog', { attachmentId });
}

export async function renameAttachment(
  attachmentId: string,
  fileName: string
): Promise<BackendAttachmentMeta> {
  return invoke('rename_attachment', { attachmentId, fileName });
}

export type AttachmentPreviewDto = {
  attachmentId: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  bytesBase64: string;
};

export async function getAttachmentBytesBase64(
  attachmentId: string
): Promise<AttachmentPreviewDto> {
  const payload = await invoke<BackendAttachmentPreviewPayload>('get_attachment_bytes_base64', {
    attachmentId,
  });

  return {
    attachmentId: payload.attachment_id,
    fileName: payload.file_name,
    mimeType: payload.mime_type,
    byteSize: payload.byte_size,
    bytesBase64: payload.base64_data,
  };
}
