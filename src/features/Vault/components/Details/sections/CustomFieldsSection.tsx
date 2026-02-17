import React from 'react';
import { IconCopy, IconPreview, IconPreviewOff } from '@/shared/icons/lucide/icons';
import { useTranslation } from '../../../../../shared/lib/i18n';
import type { CustomField } from '../../../types/ui';
import type { UseDetailsResult } from '../useDetails';
import { toCustomPreviewField, type DataCardCardPreviewField } from '../lib/previewTokens';

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

type CustomFieldsSectionProps = {
  customFields: CustomField[];
  revealedCustomFields: Record<string, boolean>;
  onToggleCustomFieldVisibility: (fieldId: string) => void;
  detailActions: UseDetailsResult;
  onOpenPreviewMenu: (field: DataCardCardPreviewField, event: React.MouseEvent, allowGlobal: boolean) => void;
  t: TranslateFn;
};

const SECRET_MASK = '\u2022'.repeat(12);

export function CustomFieldsSection({
  customFields,
  revealedCustomFields,
  onToggleCustomFieldVisibility,
  detailActions,
  onOpenPreviewMenu,
  t,
}: CustomFieldsSectionProps) {
  const { t: tTip } = useTranslation('Tooltips');
  return (
    <>
      {(customFields ?? [])
        .filter((field) => Boolean(field.value?.trim()))
        .map((field: CustomField, index: number) => {
          const fieldId = `custom-field-${index}-${field.key}`;
          const isSecret = field.type === 'secret';
          const isRevealed = Boolean(revealedCustomFields[fieldId]);
          const displayValue = isSecret ? (isRevealed ? field.value : SECRET_MASK) : field.value;

          return (
            <div key={fieldId} className="detail-field">
              <div className="detail-label">{field.key}</div>

              <div
                className="detail-value-box"
                onContextMenu={(event) => onOpenPreviewMenu(toCustomPreviewField(field.key), event, false)}
              >
                <div className="detail-value-text">{displayValue}</div>

                <div className="detail-value-actions">
                  <button
                    className="icon-button"
                    type="button"
                    aria-label={t('action.copy')}
                    title={tTip('action.copy')}
                    onClick={() => detailActions.copyToClipboard(field.value, { isSecret })}
                  >
                    <IconCopy />
                  </button>

                  {isSecret && (
                    <button
                      className="icon-button"
                      type="button"
                      aria-label={isRevealed ? t('action.hide') : t('action.reveal')}
                      title={isRevealed ? tTip('action.hide') : tTip('action.reveal')}
                      onClick={() => onToggleCustomFieldVisibility(fieldId)}
                    >
                      {isRevealed ? <IconPreviewOff /> : <IconPreview />}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
    </>
  );
}
