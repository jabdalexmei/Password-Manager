import {
  getDataCardHiddenContentByCard,
  setDataCardHiddenContentByCard,
  type DataCardHiddenContentByCardDto,
} from '@/shared/lib/tauri';
import {
  isAllowedDetailContentField,
  type DataCardDetailContentField,
  type DataCardHiddenContentByCard,
} from './datacardDetailContentFields';

const EVENT_NAME = 'datacard-hidden-content-by-card-changed';

const normalize = (input: DataCardHiddenContentByCardDto): DataCardHiddenContentByCard => {
  const out: DataCardHiddenContentByCard = {};

  for (const [rawCardId, rawFields] of Object.entries(input)) {
    const cardId = rawCardId.trim();
    if (!cardId) continue;

    const unique: DataCardDetailContentField[] = [];
    const fields = Array.isArray(rawFields) ? rawFields : [];
    for (const rawField of fields) {
      const token = String(rawField ?? '').trim();
      if (!token) continue;
      if (!isAllowedDetailContentField(token)) continue;
      if (unique.includes(token)) continue;
      unique.push(token);
    }

    if (unique.length === 0) continue;
    out[cardId] = unique;
  }

  return out;
};

export async function loadHiddenContentByCard(): Promise<DataCardHiddenContentByCard> {
  try {
    const raw = await getDataCardHiddenContentByCard();
    return normalize(raw);
  } catch {
    return {};
  }
}

export async function saveHiddenContentByCard(
  fieldsByCard: DataCardHiddenContentByCard,
): Promise<void> {
  const normalized = normalize(fieldsByCard as DataCardHiddenContentByCardDto);
  await setDataCardHiddenContentByCard(normalized);
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: normalized }));
}

export function onHiddenContentByCardChanged(
  handler: (fieldsByCard: DataCardHiddenContentByCard) => void,
): () => void {
  const listener = (event: Event) => {
    const customEvent = event as CustomEvent;
    handler(normalize(customEvent.detail ?? {}));
  };

  window.addEventListener(EVENT_NAME, listener as EventListener);
  return () => window.removeEventListener(EVENT_NAME, listener as EventListener);
}
