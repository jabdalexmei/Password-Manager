import { useEffect, useRef, useState } from 'react';
import { getCurrentWebview } from '@tauri-apps/api/webview';

type UseAttachmentsDropParams = {
  cardId: string | null | undefined;
  isTrashMode: boolean;
  onAddAttachmentsFromPaths: (paths: string[]) => Promise<void>;
};

export function useAttachmentsDrop({ cardId, isTrashMode, onAddAttachmentsFromPaths }: UseAttachmentsDropParams) {
  const attachmentsDropRef = useRef<HTMLDivElement | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const addAttachmentsFromDropRef = useRef(onAddAttachmentsFromPaths);
  useEffect(() => {
    addAttachmentsFromDropRef.current = onAddAttachmentsFromPaths;
  }, [onAddAttachmentsFromPaths]);

  const pendingDropPathsRef = useRef<Set<string>>(new Set());
  const dropFlushTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setIsDragOver(false);
    if (!cardId || isTrashMode) return;

    let disposed = false;

    const clearDropFlushTimer = () => {
      if (dropFlushTimerRef.current !== null) {
        window.clearTimeout(dropFlushTimerRef.current);
        dropFlushTimerRef.current = null;
      }
      pendingDropPathsRef.current.clear();
    };

    clearDropFlushTimer();

    const isInsideDropZone = (position: { x: number; y: number } | null | undefined) => {
      const element = attachmentsDropRef.current;
      if (!element || !position) return false;
      const rect = element.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const x = position.x / dpr;
      const y = position.y / dpr;
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    };

    const scheduleAddFromDrop = (paths: string[]) => {
      for (const path of paths) pendingDropPathsRef.current.add(path);
      if (dropFlushTimerRef.current !== null) return;

      dropFlushTimerRef.current = window.setTimeout(() => {
        dropFlushTimerRef.current = null;
        const uniquePaths = Array.from(pendingDropPathsRef.current);
        pendingDropPathsRef.current.clear();
        if (disposed || uniquePaths.length === 0) return;
        void addAttachmentsFromDropRef.current(uniquePaths);
      }, 25);
    };

    const unlistenPromise = getCurrentWebview().onDragDropEvent((event) => {
      if (disposed) return;

      const payload: any = event.payload as any;
      if (payload?.type === 'over') {
        setIsDragOver(isInsideDropZone(payload.position));
        return;
      }
      if (payload?.type === 'drop') {
        const inside = isInsideDropZone(payload.position);
        setIsDragOver(false);
        if (inside) {
          scheduleAddFromDrop((payload.paths ?? []) as string[]);
        }
        return;
      }
      setIsDragOver(false);
    });

    unlistenPromise.catch((err) => console.error(err));

    return () => {
      disposed = true;
      clearDropFlushTimer();
      void unlistenPromise.then((unlisten) => unlisten()).catch(() => undefined);
    };
  }, [cardId, isTrashMode]);

  return {
    attachmentsDropRef,
    isDragOver,
  };
}
