import React from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  backdropClassName?: string;
  confirmDisabled?: boolean;
  cancelDisabled?: boolean;
  confirmOnLeft?: boolean;
  confirmVariant?: 'danger' | 'primary';
};

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  backdropClassName,
  confirmDisabled,
  cancelDisabled,
  confirmOnLeft,
  confirmVariant = 'danger',
}) => {
  const titleId = 'confirm-dialog-title';
  const descId = 'confirm-dialog-desc';
  const confirmButton = (
    <button
      type="button"
      className={`btn ${confirmVariant === 'primary' ? 'btn-primary' : 'btn-danger'}`}
      onClick={onConfirm}
      disabled={!!confirmDisabled}
    >
      {confirmLabel}
    </button>
  );
  const cancelButton = (
    <button
      type="button"
      className="btn btn-secondary"
      onClick={onCancel}
      disabled={!!cancelDisabled}
    >
      {cancelLabel}
    </button>
  );

  return (
    <Dialog
      open={open}
      backdropClassName={backdropClassName}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !cancelDisabled) onCancel();
      }}
    >
      <DialogContent aria-labelledby={titleId} aria-describedby={descId}>
        <DialogHeader>
          <DialogTitle id={titleId}>{title}</DialogTitle>
        </DialogHeader>

        <div className="dialog-body">
          <p id={descId} className="dialog-description">
            {description}
          </p>
        </div>

        <DialogFooter className="dialog-footer--split">
          <div className="dialog-footer-left">
            {confirmOnLeft ? confirmButton : cancelButton}
          </div>
          <div className="dialog-footer-right">
            {confirmOnLeft ? cancelButton : confirmButton}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ConfirmDialog;
