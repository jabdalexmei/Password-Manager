import React from 'react';
import { IconCopy, IconPreview, IconPreviewOff } from '@/shared/icons/lucide/icons';
import { useTranslation } from '../../../../../shared/lib/i18n';
import {
  CONTENT_MASK,
  toCustomDetailContentField,
  type DataCardDetailContentField,
} from '../../../lib/datacardDetailContentFields';
import type { CustomField } from '../../../types/ui';
import type { UseDetailsResult } from '../useDetails';
import { DetailContentVisibilityButton } from '../components/DetailContentVisibilityButton';
import { toCustomPreviewField, type DataCardCardPreviewField } from '../lib/previewTokens';

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

type CustomFieldsSectionProps = {
  customFields: CustomField[];
  revealedCustomFields: Record<string, boolean>;
  onToggleCustomFieldVisibility: (fieldId: string) => void;
  detailActions: UseDetailsResult;
  onOpenPreviewMenu: (field: DataCardCardPreviewField, event: React.MouseEvent, allowGlobal: boolean) => void;
  isContentConcealed: (field: DataCardDetailContentField) => boolean;
  isContentRevealed: (field: DataCardDetailContentField) => boolean;
  onToggleContentReveal: (field: DataCardDetailContentField) => void;
  t: TranslateFn;
};

export function CustomFieldsSection({
  customFields,
  revealedCustomFields,
  onToggleCustomFieldVisibility,
  detailActions,
  onOpenPreviewMenu,
  isContentConcealed,
  isContentRevealed,
  onToggleContentReveal,
  t,
}: CustomFieldsSectionProps) {
  const { t: tTip } = useTranslation('Tooltips');
  return (
    <>
      {(customFields ?? [])
        .filter((field) => Boolean(field.value?.trim()))
        .map((field: CustomField) => {
          const fieldId = field.id;
          const isSecret = field.type === 'secret';
          const isRevealed = Boolean(revealedCustomFields[fieldId]);
          const contentField = toCustomDetailContentField(field.id);
          const isContentHidden = !isSecret && isContentConcealed(contentField);
          const isContentShown = isContentHidden && isContentRevealed(contentField);
          const displayValue = isSecret
            ? (isRevealed ? field.value : CONTENT_MASK)
            : isContentHidden && !isContentShown
              ? CONTENT_MASK
              : field.value;

          return (
            <div key={fieldId} className="detail-field">
              <div className="detail-label">{field.key}</div>

              <div
                className="detail-value-box"
                onContextMenu={(event) => onOpenPreviewMenu(toCustomPreviewField(field.id), event, false)}
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

                  {!isSecret && isContentHidden && (
                    <DetailContentVisibilityButton
                      isRevealed={isContentShown}
                      onToggle={() => onToggleContentReveal(contentField)}
                      t={t}
                    />
                  )}
                </div>
              </div>
            </div>
          );
        })}
    </>
  );
}
