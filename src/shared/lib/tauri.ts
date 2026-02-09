import { invoke } from '@tauri-apps/api/core';

export type ProfileMeta = {
  id: string;
  name: string;
  has_password: boolean;
};

export type ProfilesList = {
  profiles: ProfileMeta[];
};

export type WorkspaceItem = {
  id: string;
  display_name: string;
  path: string;
  exists: boolean;
  valid: boolean;
  is_active: boolean;
};

export async function listProfiles(): Promise<ProfilesList> {
  return invoke('profiles_list');
}

export async function createProfile(name: string, password?: string): Promise<ProfileMeta> {
  return invoke('profile_create', { name, password: password ?? null });
}

export async function deleteProfile(id: string): Promise<boolean> {
  return invoke('profile_delete', { id });
}

export async function renameProfile(id: string, name: string): Promise<ProfileMeta> {
  return invoke('profile_rename', { id, name });
}

export async function setProfilePassword(id: string, password: string): Promise<ProfileMeta> {
  return invoke('profile_set_password', { id, password });
}

export async function changeProfilePassword(id: string, password: string): Promise<boolean> {
  return invoke('profile_change_password', { id, password });
}

export async function removeProfilePassword(id: string): Promise<ProfileMeta> {
  return invoke('profile_remove_password', { id });
}

export async function setActiveProfile(id: string): Promise<boolean> {
  return invoke('set_active_profile', { id });
}

export async function getActiveProfile(): Promise<ProfileMeta | null> {
  return invoke('get_active_profile');
}

export async function loginVault(id: string, password?: string): Promise<boolean> {
  return invoke('login_vault', { id, password: password ?? null });
}

export async function lockVault(): Promise<boolean> {
  return invoke('lock_vault');
}

export async function isLoggedIn(): Promise<boolean> {
  return invoke('is_logged_in');
}

export async function healthCheck(): Promise<boolean> {
  return invoke('health_check');
}

export function workspaceList(): Promise<WorkspaceItem[]> {
  return invoke('workspace_list');
}

export function workspaceSelect(id: string): Promise<boolean> {
  return invoke('workspace_select', { id });
}

export function workspaceCreateViaDialog(): Promise<boolean> {
  return invoke('workspace_create_via_dialog');
}

export function workspaceCreateDefault(): Promise<boolean> {
  return invoke('workspace_create_default');
}

export function workspaceRemove(id: string): Promise<boolean> {
  return invoke('workspace_remove', { id });
}

export function workspaceOpenInExplorer(id: string): Promise<boolean> {
  return invoke('workspace_open_in_explorer', { id });
}

export type BackupInspectResult = {
  profile_id: string;
  profile_name: string;
  created_at_utc: string;
  vault_mode: string;
  will_overwrite: boolean;
};

export type BackupPickPayload = {
  token: string;
  file_name: string;
  byte_size: number;
  inspect: BackupInspectResult;
};

export function backupPickFile(): Promise<BackupPickPayload | null> {
  return invoke('backup_pick_file');
}

export function backupDiscardPick(token: string): Promise<void> {
  return invoke('backup_discard_pick', { token });
}

export function backupRestoreWorkflowFromPick(token: string): Promise<boolean> {
  return invoke('backup_restore_workflow_from_pick', { token });
}

export async function clipboardClearAll(): Promise<void> {
  await invoke('clipboard_clear_all');
}

export function getDataCardPreviewFields(): Promise<string[]> {
  return invoke('get_datacard_preview_fields');
}

export function setDataCardPreviewFields(fields: string[]): Promise<boolean> {
  return invoke('set_datacard_preview_fields', { fields });
}

export type BankCardPreviewFieldsDto = {
  fields: string[];
  card_number_mode: string | null;
};

export function getBankCardPreviewFields(): Promise<BankCardPreviewFieldsDto> {
  return invoke('get_bankcard_preview_fields');
}

export function setBankCardPreviewFields(prefs: BankCardPreviewFieldsDto): Promise<boolean> {
  return invoke('set_bankcard_preview_fields', { prefs });
}

export function getDataCardCoreHiddenFields(): Promise<string[]> {
  return invoke('get_datacard_core_hidden_fields');
}

export function setDataCardCoreHiddenFields(fields: string[]): Promise<boolean> {
  return invoke('set_datacard_core_hidden_fields', { fields });
}

export function getBankCardCoreHiddenFields(): Promise<string[]> {
  return invoke('get_bankcard_core_hidden_fields');
}

export function setBankCardCoreHiddenFields(fields: string[]): Promise<boolean> {
  return invoke('set_bankcard_core_hidden_fields', { fields });
}
