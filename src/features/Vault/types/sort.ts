import { Folder } from './ui';

type SortableCard = {
  title: string;
  createdAt: string;
  updatedAt: string;
};

const compareStringsCaseInsensitive = (a: string, b: string) => {
  const lowerA = a.toLowerCase();
  const lowerB = b.toLowerCase();
  if (lowerA < lowerB) return -1;
  if (lowerA > lowerB) return 1;
  return 0;
};

export function sortFolders(a: Folder, b: Folder): number {
  const byName = compareStringsCaseInsensitive(a.name, b.name);
  if (byName !== 0) return byName;
  return compareStringsCaseInsensitive(a.id, b.id);
}

const compareDates = (a: string, b: string, direction: 'ASC' | 'DESC') => {
  const aTime = Date.parse(a);
  const bTime = Date.parse(b);
  if (aTime === bTime) return 0;
  if (direction === 'ASC') {
    return aTime < bTime ? -1 : 1;
  }
  return aTime > bTime ? -1 : 1;
};

const compareTitles = (a: string, b: string, direction: 'ASC' | 'DESC') => {
  const result = compareStringsCaseInsensitive(a, b);
  return direction === 'ASC' ? result : -result;
};

export function sortCards<T extends SortableCard>(
  a: T,
  b: T,
  sortField: string,
  sortDir: string
): number {
  const field = (sortField ?? 'updated_at') as 'created_at' | 'updated_at' | 'title';
  const direction = (sortDir ?? 'DESC') as 'ASC' | 'DESC';

  if (field === 'title') {
    const byTitle = compareTitles(a.title, b.title, direction);
    if (byTitle !== 0) return byTitle;
    return compareDates(a.updatedAt, b.updatedAt, 'DESC');
  }

  const primaryDateCompare = compareDates(
    field === 'created_at' ? a.createdAt : a.updatedAt,
    field === 'created_at' ? b.createdAt : b.updatedAt,
    direction
  );

  if (primaryDateCompare !== 0) return primaryDateCompare;
  return compareStringsCaseInsensitive(a.title, b.title);
}
