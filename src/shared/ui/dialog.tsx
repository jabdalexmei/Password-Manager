import React, { createContext, useCallback, useContext, useEffect, useRef } from 'react';

type DialogProps = {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
};

type DialogSlotProps = React.HTMLAttributes<HTMLDivElement>;

type DialogTitleProps = React.HTMLAttributes<HTMLHeadingElement>;
type DialogContentProps = React.HTMLAttributes<HTMLDivElement> & {
  showCloseButton?: boolean;
  closeAriaLabel?: string;
};

const mergeClasses = (base: string, extra?: string) => (extra ? `${base} ${extra}` : base);
const DialogContext = createContext<{ canClose: boolean; close: () => void } | null>(null);
let dialogInstanceCounter = 0;
let openDialogStack: string[] = [];

export function Dialog({ open, onOpenChange, children }: DialogProps) {
  const dialogIdRef = useRef<string>(`dialog_${++dialogInstanceCounter}`);
  const close = useCallback(() => onOpenChange?.(false), [onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const dialogId = dialogIdRef.current;
    openDialogStack = [...openDialogStack, dialogId];

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const topDialogId = openDialogStack[openDialogStack.length - 1];
        if (topDialogId !== dialogId) return;
        e.stopPropagation();
        close();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      openDialogStack = openDialogStack.filter((id) => id !== dialogId);
    };
  }, [close, open]);

  if (!open) return null;

  return (
    <DialogContext.Provider value={{ canClose: Boolean(onOpenChange), close }}>
      <div
        className="dialog-backdrop"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) {
            close();
          }
        }}
      >
        {children}
      </div>
    </DialogContext.Provider>
  );
}

export function DialogContent({
  className,
  showCloseButton = true,
  closeAriaLabel = 'Close',
  children,
  ...props
}: DialogContentProps) {
  const ctx = useContext(DialogContext);
  return (
    <div className={mergeClasses('dialog', className)} role="dialog" aria-modal="true" {...props}>
      {showCloseButton && ctx?.canClose && (
        <button className="dialog-close dialog-close--topright" type="button" aria-label={closeAriaLabel} onClick={ctx.close}>
          {'\u00D7'}
        </button>
      )}
      {children}
    </div>
  );
}

export function DialogHeader({ className, ...props }: DialogSlotProps) {
  return <div className={mergeClasses('dialog-header', className)} {...props} />;
}

export function DialogTitle({ className, ...props }: DialogTitleProps) {
  return <h2 className={mergeClasses('dialog-title', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: DialogSlotProps) {
  return <div className={mergeClasses('dialog-footer', className)} {...props} />;
}
