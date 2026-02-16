export const parseTrashRetentionDays = (raw: string): number | null => {
  const value = Number(raw);
  if (!Number.isInteger(value)) return null;
  if (value < 1 || value > 3650) return null;
  return value;
};
