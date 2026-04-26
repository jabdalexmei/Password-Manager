import { isCustomFieldId } from '../../../lib/customFieldId';

export const CUSTOM_PREVIEW_PREFIX = 'custom:' as const;

export const isCustomPreviewField = (
  value: string
): value is `${typeof CUSTOM_PREVIEW_PREFIX}${string}` =>
  value.startsWith(CUSTOM_PREVIEW_PREFIX) &&
  isCustomFieldId(value.slice(CUSTOM_PREVIEW_PREFIX.length));

export const mergeToken = (token: string, target: string[]) => {
  const trimmed = token.trim();
  if (!trimmed) return;
  if (target.includes(trimmed)) return;
  target.push(trimmed);
};
