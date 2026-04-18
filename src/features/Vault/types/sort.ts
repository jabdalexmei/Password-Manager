import { Folder } from './ui';

type SortableCard = {
  title: string;
  createdAt: string;
  updatedAt: string;
};

type SortField = 'created_at' | 'updated_at' | 'title';
type SortDirection = 'ASC' | 'DESC';

const DEFAULT_SORT_FIELD: SortField = 'updated_at';
const DEFAULT_SORT_DIRECTION: SortDirection = 'DESC';

const compareStringsCaseInsensitive = (a: string, b: string) => {
  const lowerA = a.toLowerCase();
  const lowerB = b.toLowerCase();
  if (lowerA < lowerB) return -1;
  if (lowerA > lowerB) return 1;
  return 0;
};

const compareStringsCaseSensitive = (a: string, b: string) => {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
};

export function sortFolders(a: Folder, b: Folder): number {
  const byName = compareStringsCaseInsensitive(a.name, b.name);
  if (byName !== 0) return byName;
  return compareStringsCaseInsensitive(a.id, b.id);
}

const compareDates = (a: string, b: string, direction: SortDirection) => {
  const aTime = Date.parse(a);
  const bTime = Date.parse(b);
  if (aTime === bTime) return 0;
  if (direction === 'ASC') {
    return aTime < bTime ? -1 : 1;
  }
  return aTime > bTime ? -1 : 1;
};

const normalizeSortField = (raw: string): SortField => {
  switch (raw.trim().toLowerCase()) {
    case 'created_at':
      return 'created_at';
    case 'updated_at':
      return 'updated_at';
    case 'title':
      return 'title';
    default:
      return DEFAULT_SORT_FIELD;
  }
};

const normalizeSortDirection = (raw: string): SortDirection => {
  switch (raw.trim().toUpperCase()) {
    case 'ASC':
      return 'ASC';
    case 'DESC':
      return 'DESC';
    default:
      return DEFAULT_SORT_DIRECTION;
  }
};

const compareTitles = (a: string, b: string, direction: SortDirection) => {
  const result = compareStringsCaseSensitive(a, b);
  return direction === 'ASC' ? result : -result;
};

export function sortCards<T extends SortableCard>(
  a: T,
  b: T,
  sortField: string,
  sortDir: string
): number {
  const field = normalizeSortField(sortField ?? DEFAULT_SORT_FIELD);
  const direction = normalizeSortDirection(sortDir ?? DEFAULT_SORT_DIRECTION);

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
  return compareStringsCaseSensitive(a.title, b.title);
}
