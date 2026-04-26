import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from '../../../../shared/lib/i18n';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../../../shared/ui/dialog';
import type { Folder } from '../../types/ui';

type MoveSelectedModalProps = {
  open: boolean;
  count: number;
  folders: Folder[];
  onCancel: () => void;
  onCreateFolder: (name: string) => Promise<Folder | null>;
  onMove: (folderId: string | null) => Promise<void>;
};

export function MoveSelectedModal({
  open,
  count,
  folders,
  onCancel,
  onCreateFolder,
  onMove,
}: MoveSelectedModalProps) {
  const { t } = useTranslation('Vault');
  const { t: tCommon } = useTranslation('Common');
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [isSubmitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = useMemo(
    () => folders.filter((folder) => !folder.isSystem && !folder.deletedAt),
    [folders]
  );

  useEffect(() => {
    if (!open) return;
    setSelectedFolderId(null);
    setNewFolderName('');
    setSubmitting(false);
    setError(null);
  }, [open]);

  const createAndSelect = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await onCreateFolder(name);
      if (!created) {
        setError(t('bulk.move.createError'));
        return;
      }
      setSelectedFolderId(created.id);
      setNewFolderName('');
    } finally {
      setSubmitting(false);
    }
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await onMove(selectedFolderId);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen && !isSubmitting) onCancel();
    }}>
      <DialogContent aria-labelledby="bulk-move-title">
        <DialogHeader>
          <DialogTitle id="bulk-move-title">{t('bulk.move.title', { count })}</DialogTitle>
        </DialogHeader>

        <div className="dialog-body">
          <div className="form-field">
            <label className="form-label">{t('bulk.move.chooseFolder')}</label>
            <div className="vault-bulk-folder-list" role="radiogroup">
              <button
                className={`vault-bulk-folder-option ${selectedFolderId === null ? 'selected' : ''}`.trim()}
                type="button"
                onClick={() => setSelectedFolderId(null)}
              >
                {t('bulk.move.noFolder')}
              </button>
              {options.map((folder) => (
                <button
                  key={folder.id}
                  className={`vault-bulk-folder-option ${selectedFolderId === folder.id ? 'selected' : ''}`.trim()}
                  type="button"
                  onClick={() => setSelectedFolderId(folder.id)}
                >
                  {folder.name}
                </button>
              ))}
            </div>
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="bulk-new-folder-input">
              {t('bulk.move.createFolder')}
            </label>
            <div className="vault-bulk-folder-create">
              <input
                id="bulk-new-folder-input"
                className="input"
                value={newFolderName}
                disabled={isSubmitting}
                onChange={(event) => setNewFolderName(event.target.value)}
                placeholder={t('bulk.move.folderName')}
              />
              <button
                className="btn btn-secondary"
                type="button"
                disabled={isSubmitting || newFolderName.trim().length === 0}
                onClick={() => void createAndSelect()}
              >
                {t('bulk.move.create')}
              </button>
            </div>
            {error && <div className="form-error">{error}</div>}
          </div>
        </div>

        <DialogFooter className="dialog-footer--split">
          <div className="dialog-footer-left">
            <button className="btn btn-secondary" type="button" disabled={isSubmitting} onClick={onCancel}>
              {tCommon('action.cancel')}
            </button>
          </div>
          <div className="dialog-footer-right">
            <button className="btn btn-primary" type="button" disabled={isSubmitting} onClick={() => void submit()}>
              {t('bulk.move.confirm')}
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
