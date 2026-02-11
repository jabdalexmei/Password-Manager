import React from 'react';
import { useTranslation } from '../../../../shared/lib/i18n';

type CustomFieldModalProps = {
  isOpen: boolean;
  name: string;
  error: string | null;
  onChangeName: (value: string) => void;
  onCancel: () => void;
  onOk: () => void;
};

export const CustomFieldModal: React.FC<CustomFieldModalProps> = ({
  isOpen,
  name,
  error,
  onChangeName,
  onCancel,
  onOk,
}) => {
  const { t } = useTranslation('DataCards');

  if (!isOpen) return null;

  return (
    <div
      className="dialog-backdrop dialog-backdrop--inner"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <div className="dialog customfield-dialog" role="dialog" aria-modal="true" aria-labelledby="customfield-title">
        <button className="dialog-close dialog-close--topright" type="button" aria-label="Close" onClick={onCancel}>
          {'\u00D7'}
        </button>
        <div className="dialog-header">
          <h2 id="customfield-title" className="dialog-title">
            {t('customFields.modalTitle')}
          </h2>
        </div>

        <div className="dialog-body">
          <div className="form-field">
            <label className="form-label" htmlFor="customfield-name">
              {t('customFields.nameLabel')}
            </label>
            <input
              id="customfield-name"
              className="input"
              value={name}
              placeholder={t('customFields.namePlaceholder')}
              onChange={(event) => onChangeName(event.target.value)}
            />
            {error && <div className="form-error">{error}</div>}
          </div>
        </div>

        <div className="dialog-footer dialog-footer--split">
          <div className="dialog-footer-left">
            <button className="btn btn-secondary" type="button" onClick={onCancel}>
              {t('action.cancel')}
            </button>
          </div>
          <div className="dialog-footer-right">
            <button className="btn btn-primary" type="button" onClick={onOk}>
              {t('action.ok')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
