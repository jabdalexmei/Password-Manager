import { useCallback, useMemo, useState } from 'react';
import type { BulkVaultItemRef, BulkVaultItemType } from '../api/vaultApi';

export type BulkSelectionItem = BulkVaultItemRef;
export type BulkSelectionKey = `${BulkVaultItemType}:${string}`;

export const makeBulkSelectionKey = (item: BulkSelectionItem): BulkSelectionKey =>
  `${item.item_type}:${item.id}`;

export function useBulkSelection() {
  const [isSelectionMode, setSelectionMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<BulkSelectionKey>>(() => new Set());

  const selectedItems = useMemo<BulkSelectionItem[]>(
    () =>
      Array.from(selectedKeys).map((key) => {
        const [item_type, ...idParts] = key.split(':');
        return { item_type: item_type as BulkVaultItemType, id: idParts.join(':') };
      }),
    [selectedKeys]
  );

  const enterSelectionMode = useCallback(() => {
    setSelectionMode(true);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedKeys(new Set());
  }, []);

  const cancelSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedKeys(new Set());
  }, []);

  const toggleItem = useCallback((item: BulkSelectionItem) => {
    const key = makeBulkSelectionKey(item);
    setSelectionMode(true);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const selectVisible = useCallback((items: BulkSelectionItem[]) => {
    setSelectionMode(true);
    setSelectedKeys(new Set(items.map(makeBulkSelectionKey)));
  }, []);

  const isSelected = useCallback(
    (item: BulkSelectionItem) => selectedKeys.has(makeBulkSelectionKey(item)),
    [selectedKeys]
  );

  return {
    isSelectionMode,
    selectedKeys,
    selectedItems,
    selectedCount: selectedKeys.size,
    enterSelectionMode,
    clearSelection,
    cancelSelection,
    toggleItem,
    selectVisible,
    isSelected,
  };
}
