export const formatVaultDateTime = (value: string | number | Date): string => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString();
};
