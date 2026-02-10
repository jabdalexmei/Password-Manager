export function wasActuallyUpdated(
  createdAt?: string | null,
  updatedAt?: string | null
): boolean {
  if (!createdAt || !updatedAt) return false;

  const createdMs = Date.parse(createdAt);
  const updatedMs = Date.parse(updatedAt);

  if (!Number.isFinite(createdMs) || !Number.isFinite(updatedMs)) {
    return false;
  }

  return updatedMs > createdMs;
}
