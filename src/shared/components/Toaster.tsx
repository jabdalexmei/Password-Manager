import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { useTranslation } from '../lib/i18n';

type ToastVariant = 'success' | 'error';

type Toast = { id: number; message: string; variant: ToastVariant };

type ToasterContextValue = {
  show: (message: string, variant?: ToastVariant) => void;
};

const ToasterContext = createContext<ToasterContextValue | undefined>(undefined);

export const ToasterProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextIdRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (message: string, variant: ToastVariant = 'success') => {
      const id = nextIdRef.current++;
      setToasts((prev) => [...prev, { id, message, variant }]);
      setTimeout(() => dismiss(id), 1000);
    },
    [dismiss]
  );

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToasterContext.Provider value={value}>
      {children}
      <div className="toast-host">
        {toasts.map((toast) => (
          <div
            className={`toast ${toast.variant === 'success' ? 'toast-success' : 'toast-error'}`}
            key={toast.id}
          >
            <div className="toast-body">
              <p className="toast-title">{toast.message}</p>
            </div>
            <button
              type="button"
              className="toast-close"
              onClick={() => dismiss(toast.id)}
              aria-label="Close"
            >
              ×
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
