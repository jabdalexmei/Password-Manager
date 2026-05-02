import { getBankCardPreviewFields, setBankCardPreviewFields, type BankCardPreviewFieldsDto } from '../../../shared/lib/tauri';

export type BankCardPreviewField = 'bank_name' | 'holder' | 'note' | 'tags';
export type BankCardCardNumberMode = 'full' | 'last_four' | null;

export type BankCardPreviewFields = {
  fields: BankCardPreviewField[];
  cardNumberMode: BankCardCardNumberMode;
};

export function normalizeBankCardPreviewFields(value: BankCardPreviewFieldsDto | null | undefined): BankCardPreviewFields {
  const rawFields = Array.isArray(value?.fields) ? value!.fields : [];
  const fields: BankCardPreviewField[] = [];
  for (const f of rawFields) {
    if (f === 'bank_name' || f === 'holder' || f === 'note' || f === 'tags') {
      if (!fields.includes(f)) fields.push(f);
    }
  }

  const mode = value?.card_number_mode;
  const cardNumberMode: BankCardCardNumberMode = mode === 'full' || mode === 'last_four' ? mode : null;
  return { fields, cardNumberMode };
}

export function toBackendBankCardPreviewFields(prefs: BankCardPreviewFields): BankCardPreviewFieldsDto {
  return {
    fields: prefs.fields,
    card_number_mode: prefs.cardNumberMode,
  };
}

export async function loadBankCardPreviewFields(): Promise<BankCardPreviewFields> {
  return normalizeBankCardPreviewFields(await getBankCardPreviewFields());
}

export async function saveBankCardPreviewFields(prefs: BankCardPreviewFields): Promise<boolean> {
  const ok = await setBankCardPreviewFields(toBackendBankCardPreviewFields(prefs));
  if (ok) {
    window.dispatchEvent(new CustomEvent('bankcard-preview-fields-changed'));
  }
  return ok;
}

export function formatCardNumberFull(number: string): string {
  const digits = number.replace(/\D/g, '');
  if (!digits) return '';
  return digits.replace(/(.{4})/g, '$1 ').trim();
}

export function formatCardNumberLastFour(number: string): string {
  const digits = number.replace(/\D/g, '');
  if (digits.length <= 4) return digits;
  return digits.slice(-4);
}
