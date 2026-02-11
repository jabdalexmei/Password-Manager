import { useEffect, useState } from 'react';
import { searchDataCards } from '../../api/vaultApi';
import { useDebouncedValue } from '../useDebouncedValue';

export function useVaultSearch() {
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearchQuery = useDebouncedValue(searchInput, 200);
  const [searchMatchIds, setSearchMatchIds] = useState<Set<string> | null>(null);

  useEffect(() => {
    const q = debouncedSearchQuery.trim();
    if (!q) {
      setSearchMatchIds(null);
      return;
    }

    let cancelled = false;
    searchDataCards(q)
      .then((ids) => {
        if (cancelled) return;
        setSearchMatchIds(new Set(ids));
      })
      .catch((err) => {
        console.error(err);
        if (cancelled) return;
        setSearchMatchIds(new Set());
      });

    return () => {
      cancelled = true;
    };
  }, [debouncedSearchQuery]);

  return {
    searchInput,
    setSearchInput,
    debouncedSearchQuery,
    searchMatchIds,
    setSearchMatchIds,
  };
}
