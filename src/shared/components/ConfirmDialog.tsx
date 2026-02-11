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
  confirmDisabled?: boolean;
  cancelDisabled?: boolean;
};

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  confirmDisabled,
  cancelDisabled,
}) => {
  const titleId = 'confirm-dialog-title';
  const descId = 'confirm-dialog-desc';

  return (
    <Dialog
      open={open}
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

        <DialogFooter className="dialog-footer">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onCancel}
            disabled={!!cancelDisabled}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={onConfirm}
            disabled={!!confirmDisabled}
          >
            {confirmLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ConfirmDialog;
