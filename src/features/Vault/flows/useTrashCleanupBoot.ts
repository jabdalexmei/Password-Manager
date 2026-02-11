import { useEffect, useRef } from 'react';

type UseTrashCleanupBootParams = {
  profileId: string;
  activeVaultId: string;
  isReady: boolean;
  runCleanup: () => void;
};

export function useTrashCleanupBoot({ profileId, activeVaultId, isReady, runCleanup }: UseTrashCleanupBootParams) {
  const trashCleanupBootRunKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isReady) return;
    const runKey = `${profileId}:${activeVaultId}`;
    if (trashCleanupBootRunKeyRef.current === runKey) return;
    trashCleanupBootRunKeyRef.current = runKey;
    runCleanup();
  }, [activeVaultId, isReady, profileId, runCleanup]);
}
