import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from '../lib/i18n';

type ToastVariant = 'success' | 'error';

type Toast = { id: number; message: string; variant: ToastVariant };
type ToastTimer = ReturnType<typeof setTimeout>;

const TOAST_TTL_MS = 2000;
const MAX_VISIBLE_TOASTS = 2;
const MOVE_ANIMATION_MS = 180;

type ToasterContextValue = {
  show: (message: string, variant?: ToastVariant) => void;
};

const ToasterContext = createContext<ToasterContextValue | undefined>(undefined);

export const ToasterProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t: tCommon } = useTranslation('Common');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextIdRef = useRef(0);
  const timersRef = useRef(new Map<number, ToastTimer>());
  const toastNodesRef = useRef(new Map<number, HTMLDivElement>());
  const prevRectsRef = useRef(new Map<number, DOMRect>());

  const setToastNodeRef = useCallback((id: number, node: HTMLDivElement | null) => {
    if (node) {
      toastNodesRef.current.set(id, node);
      return;
    }
    toastNodesRef.current.delete(id);
  }, []);

  const dismiss = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (message: string, variant: ToastVariant = 'success') => {
      const id = nextIdRef.current++;
      setToasts((prev) => {
        const next = [...prev, { id, message, variant }];
        return next.length > MAX_VISIBLE_TOASTS ? next.slice(next.length - MAX_VISIBLE_TOASTS) : next;
      });

      const timer = setTimeout(() => dismiss(id), TOAST_TTL_MS);
      timersRef.current.set(id, timer);
    },
    [dismiss]
  );

  useEffect(() => {
    const currentIds = new Set(toasts.map((toast) => toast.id));
    timersRef.current.forEach((timer, id) => {
      if (currentIds.has(id)) return;
      clearTimeout(timer);
      timersRef.current.delete(id);
    });
  }, [toasts]);

  useEffect(() => {
    return () => {
      timersRef.current.forEach((timer) => clearTimeout(timer));
      timersRef.current.clear();
    };
  }, []);

  useLayoutEffect(() => {
    const nextRects = new Map<number, DOMRect>();

    toasts.forEach((toast) => {
      const node = toastNodesRef.current.get(toast.id);
      if (!node) return;

      const prevRect = prevRectsRef.current.get(toast.id);
      const nextRect = node.getBoundingClientRect();
      nextRects.set(toast.id, nextRect);

      if (typeof node.animate !== 'function') return;

      if (typeof node.getAnimations === 'function') {
        node.getAnimations().forEach((animation) => animation.cancel());
      }

      if (prevRect) {
        const deltaY = prevRect.top - nextRect.top;
        if (Math.abs(deltaY) < 0.5) return;
        node.animate(
          [
            { transform: `translateY(${deltaY}px)` },
            { transform: 'translateY(0)' },
          ],
          { duration: MOVE_ANIMATION_MS, easing: 'ease-out' }
        );
        return;
      }

      node.animate(
        [
          { opacity: 0, transform: 'translateY(12px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ],
        { duration: MOVE_ANIMATION_MS, easing: 'ease-out' }
      );
    });

    prevRectsRef.current = nextRects;
  }, [toasts]);

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToasterContext.Provider value={value}>
      {children}
      <div className="toast-host">
        {toasts.map((toast) => (
          <div
            className={`toast ${toast.variant === 'success' ? 'toast-success' : 'toast-error'}`}
            key={toast.id}
            ref={(node) => setToastNodeRef(toast.id, node)}
          >
            <div className="toast-body">
              <p className="toast-title">{toast.message}</p>
            </div>
            <button
              type="button"
              className="toast-close"
              onClick={() => dismiss(toast.id)}
              aria-label={tCommon('aria.dismissToast')}
            >
              {'\u00D7'}
            </button>
          </div>
        ))}
      </div>
    </ToasterContext.Provider>
  );
};

export const useToaster = () => {
  const { t: tCommon } = useTranslation('Common');
  const ctx = useContext(ToasterContext);
  if (!ctx) {
    throw new Error(tCommon('error.hookToaster'));
  }
  return ctx;
};
