import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { attachmentsDiscardPick } from '../../../api/vaultApi';

type UseAttachmentsDropParams = {
  cardId: string | null | undefined;
  isTrashMode: boolean;
  onAddAttachmentsFromPick: (token: string, fileIds: string[]) => Promise<void>;
};

type DndPositionPayload = {
  x: number;
  y: number;
};

type NormalizedDropPayload = {
  token: string;
  fileIds: string[];
  position: DndPositionPayload;
};

function normalizePosition(raw: unknown): DndPositionPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as { x?: unknown; y?: unknown };
  if (typeof candidate.x !== 'number' || typeof candidate.y !== 'number') return null;
  return { x: candidate.x, y: candidate.y };
}

function normalizeDropPayload(raw: unknown): NormalizedDropPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as {
    token?: unknown;
    files?: unknown;
    position?: unknown;
  };
  if (typeof candidate.token !== 'string' || !candidate.token.trim()) return null;
  const position = normalizePosition(candidate.position);
  if (!position) return null;

  const fileIds = Array.isArray(candidate.files)
    ? candidate.files
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const entry = item as { id?: unknown };
          return typeof entry.id === 'string' && entry.id.trim() ? entry.id : null;
        })
        .filter((id): id is string => Boolean(id))
    : [];

  return {
    token: candidate.token,
    fileIds: Array.from(new Set(fileIds)),
    position,
  };
}

export function useAttachmentsDrop({ cardId, isTrashMode, onAddAttachmentsFromPick }: UseAttachmentsDropParams) {
  const attachmentsDropRef = useRef<HTMLDivElement | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const addAttachmentsFromPickRef = useRef(onAddAttachmentsFromPick);
  useEffect(() => {
    addAttachmentsFromPickRef.current = onAddAttachmentsFromPick;
  }, [onAddAttachmentsFromPick]);

  useEffect(() => {
    setIsDragOver(false);

    let disposed = false;

    const isInsideDropZone = (position: { x: number; y: number } | null | undefined) => {
      const element = attachmentsDropRef.current;
      if (!element || !position) return false;
      const rect = element.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const x = position.x / dpr;
      const y = position.y / dpr;
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    };

    const unlistenOverPromise = listen<unknown>('attachments://dnd-over', (event) => {
      if (disposed) return;
      const canDrop = Boolean(cardId) && !isTrashMode;
      if (!canDrop) {
        setIsDragOver(false);
        return;
      }
      const position = normalizePosition(event.payload);
      setIsDragOver(Boolean(position && isInsideDropZone(position)));
    });

    const unlistenLeavePromise = listen('attachments://dnd-leave', () => {
      if (disposed) return;
      setIsDragOver(false);
    });

    const unlistenDropPromise = listen<unknown>('attachments://dnd-drop-picked', (event) => {
      if (disposed) return;
      const payload = normalizeDropPayload(event.payload);
      if (!payload) {
        setIsDragOver(false);
        return;
      }
      const canAdd =
        Boolean(cardId) &&
        !isTrashMode &&
        payload.fileIds.length > 0 &&
        isInsideDropZone(payload.position);
      setIsDragOver(false);

      if (!canAdd) {
        void attachmentsDiscardPick(payload.token).catch((err) => console.error(err));
        return;
      }

      void addAttachmentsFromPickRef
        .current(payload.token, payload.fileIds)
        .catch((err) => {
          console.error(err);
          void attachmentsDiscardPick(payload.token).catch((discardErr) => console.error(discardErr));
        });
    });

    unlistenOverPromise.catch((err) => console.error(err));
    unlistenLeavePromise.catch((err) => console.error(err));
    unlistenDropPromise.catch((err) => console.error(err));

    return () => {
      disposed = true;
      setIsDragOver(false);
      void unlistenOverPromise.then((unlisten) => unlisten()).catch(() => undefined);
      void unlistenLeavePromise.then((unlisten) => unlisten()).catch(() => undefined);
      void unlistenDropPromise.then((unlisten) => unlisten()).catch(() => undefined);
    };
  }, [cardId, isTrashMode]);

  return {
    attachmentsDropRef,
    isDragOver,
  };
}
