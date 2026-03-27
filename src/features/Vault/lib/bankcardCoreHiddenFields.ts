import { getBankCardCoreHiddenFields, setBankCardCoreHiddenFields } from '@/shared/lib/tauri';

export type BankCardCoreField = 'title';

const EVENT_NAME = 'bankcard-core-hidden-fields-changed';

const isAllowed = (value: string): value is BankCardCoreField => value === 'title';

export async function loadBankCardCoreHiddenFields(): Promise<BankCardCoreField[]> {
  try {
    const raw = await getBankCardCoreHiddenFields();
    const out: BankCardCoreField[] = [];
    for (const item of raw) {
      if (!isAllowed(item)) continue;
      if (out.includes(item)) continue;
      out.push(item);
    }
    return out;
  } catch {
    return [];
  }
}

export async function saveBankCardCoreHiddenFields(fields: BankCardCoreField[]): Promise<void> {
  const unique: BankCardCoreField[] = [];
  for (const f of fields) {
    if (!unique.includes(f)) unique.push(f);
  }
  await setBankCardCoreHiddenFields(unique);
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: unique }));
}

export function onBankCardCoreHiddenFieldsChanged(handler: (fields: BankCardCoreField[]) => void): () => void {
  const listener = (evt: Event) => {
    const custom = evt as CustomEvent;
    const raw = Array.isArray(custom.detail) ? custom.detail : [];
    const fields: BankCardCoreField[] = raw.filter(isAllowed);
    handler(fields);
  };

  window.addEventListener(EVENT_NAME, listener as EventListener);
  return () => window.removeEventListener(EVENT_NAME, listener as EventListener);
}
