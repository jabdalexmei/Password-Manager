export const CUSTOM_FIELD_ID_PREFIX = 'cf_' as const;

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const isCustomFieldId = (value: string): boolean => {
  if (!value.startsWith(CUSTOM_FIELD_ID_PREFIX)) return false;
  const rawUuid = value.slice(CUSTOM_FIELD_ID_PREFIX.length);
  return UUID_V4_RE.test(rawUuid);
};

export const generateCustomFieldId = (): string => {
  const rawUuid = globalThis.crypto?.randomUUID?.();
  if (rawUuid) {
    return `${CUSTOM_FIELD_ID_PREFIX}${rawUuid.toLowerCase()}`;
  }

  const fallback =
    `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 14)}-4${Math.random()
      .toString(16)
      .slice(2, 5)}-a${Math.random().toString(16).slice(2, 5)}-${Math.random()
      .toString(16)
      .slice(2, 14)}`.slice(0, 36);

  return `${CUSTOM_FIELD_ID_PREFIX}${fallback}`;
};
