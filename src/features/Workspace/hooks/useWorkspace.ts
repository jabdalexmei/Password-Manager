import { useCallback, useEffect, useState } from 'react';
import { WorkspaceItem, workspaceList, workspaceRemove } from '../../../shared/lib/tauri';

export const useWorkspace = () => {
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const items = await workspaceList();
      setWorkspaces(items);
      const active = items.find((item) => item.is_active);
      setSelectedId(active?.id ?? null);
    } catch (err) {
      console.error(err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const remove = useCallback(
    async (id: string) => {
      await workspaceRemove(id);
      await refresh();
    },
    [refresh]
  );

  return {
    workspaces,
    loading,
    error,
    selectedId,
    setSelectedId,
    refresh,
    remove,
  };
};
