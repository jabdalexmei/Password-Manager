import type { Language } from '../../../shared/lib/i18n';
import type { BackendDateTimeFormat } from '../types/backend';

type DateTimePreset = 'ddmmyyyy_24h' | 'mmddyyyy_12h_ampm';

const resolveDateTimePreset = (format: BackendDateTimeFormat, language: Language): DateTimePreset => {
  if (format === 'auto') {
    return language === 'ru' ? 'ddmmyyyy_24h' : 'mmddyyyy_12h_ampm';
  }

  return format;
};

export const createVaultDateTimeFormatter = (
  format: BackendDateTimeFormat,
  language: Language,
): Intl.DateTimeFormat => {
  const preset = resolveDateTimePreset(format, language);

  if (preset === 'ddmmyyyy_24h') {
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
};

export const formatVaultDateTime = (
  value: string | number | Date,
  format: BackendDateTimeFormat,
  language: Language,
): string => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return createVaultDateTimeFormatter(format, language).format(date);
};
