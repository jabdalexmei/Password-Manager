import { useCallback, useEffect, useState } from 'react';
import { deleteProfile, listProfiles, ProfileMeta } from '../../../shared/lib/tauri';

export const useStartup = () => {
  const [profiles, setProfiles] = useState<ProfileMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await listProfiles();
      setProfiles(response.profiles);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const removeProfile = useCallback(
    async (id: string) => {
      await deleteProfile(id);
      await load();
    },
    [load]
  );

  return { profiles, loading, error, refresh: load, removeProfile };
};
