import { getDataCardCoreHiddenFields, setDataCardCoreHiddenFields } from '@/shared/lib/tauri';

export type DataCardCoreField = 'title' | 'url' | 'email';

const EVENT_NAME = 'datacard-core-hidden-fields-changed';

const isAllowed = (value: string): value is DataCardCoreField =>
  value === 'title' || value === 'url' || value === 'email';

export async function loadCoreHiddenFields(): Promise<DataCardCoreField[]> {
  try {
    const raw = await getDataCardCoreHiddenFields();
    const out: DataCardCoreField[] = [];
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

export async function saveCoreHiddenFields(fields: DataCardCoreField[]): Promise<void> {
  const unique: DataCardCoreField[] = [];
  for (const f of fields) {
    if (!unique.includes(f)) unique.push(f);
  }
  await setDataCardCoreHiddenFields(unique);
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: unique }));
}

export function onCoreHiddenFieldsChanged(handler: (fields: DataCardCoreField[]) => void): () => void {
  const listener = (evt: Event) => {
    const custom = evt as CustomEvent;
    const raw = Array.isArray(custom.detail) ? custom.detail : [];
    const fields: DataCardCoreField[] = raw.filter(isAllowed);
    handler(fields);
  };

  window.addEventListener(EVENT_NAME, listener as EventListener);
  return () => window.removeEventListener(EVENT_NAME, listener as EventListener);
}
