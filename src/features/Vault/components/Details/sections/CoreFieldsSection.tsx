import React from 'react';
import { IconCopy, IconHistory, IconPreview, IconPreviewOff } from '@/shared/icons/lucide/icons';
import { useTranslation } from '../../../../../shared/lib/i18n';
import { CONTENT_MASK, type DataCardDetailContentField } from '../../../lib/datacardDetailContentFields';
import type { DataCard } from '../../../types/ui';
import type { DataCardCoreField } from '../../../lib/datacardCoreHiddenFields';
import type { UseDetailsResult } from '../useDetails';
import { DetailContentVisibilityButton } from '../components/DetailContentVisibilityButton';
import type { DataCardCardPreviewField } from '../lib/previewTokens';

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

type CoreFieldsSectionProps = {
  card: DataCard;
  detailActions: UseDetailsResult;
  onOpenCoreMenu: (field: DataCardCoreField, event: React.MouseEvent) => void;
  onOpenPreviewMenu: (field: DataCardCardPreviewField, event: React.MouseEvent, allowGlobal: boolean) => void;
  onOpenHistory: () => void;
  isContentConcealed: (field: DataCardDetailContentField) => boolean;
  isContentRevealed: (field: DataCardDetailContentField) => boolean;
  onToggleContentReveal: (field: DataCardDetailContentField) => void;
  t: TranslateFn;
};

export function CoreFieldsSection({
  card,
  detailActions,
  onOpenCoreMenu,
  onOpenPreviewMenu,
  onOpenHistory,
  isContentConcealed,
  isContentRevealed,
  onToggleContentReveal,
  t,
}: CoreFieldsSectionProps) {
  const { t: tTip } = useTranslation('Tooltips');
  const hasValue = (value?: string | null) => Boolean(value?.trim());
  const hasTitle = hasValue(card.title);
  const hasUrl = hasValue(card.url);
  const hasEmail = hasValue(card.email);
  const hasRecoveryEmail = hasValue(card.recoveryEmail);
  const hasUsername = hasValue(card.username);
  const hasMobilePhone = hasValue(card.mobilePhone);
  const hasPassword = hasValue(card.password);
  const titleDisplay = isContentConcealed('title') && !isContentRevealed('title') ? CONTENT_MASK : card.title;
  const urlDisplay = isContentConcealed('url') && !isContentRevealed('url') ? CONTENT_MASK : card.url ?? '';
  const emailDisplay = isContentConcealed('email') && !isContentRevealed('email') ? CONTENT_MASK : card.email ?? '';
  const recoveryEmailDisplay =
    isContentConcealed('recovery_email') && !isContentRevealed('recovery_email') ? CONTENT_MASK : card.recoveryEmail ?? '';
  const usernameDisplay =
    isContentConcealed('username') && !isContentRevealed('username') ? CONTENT_MASK : card.username ?? '';
  const mobilePhoneDisplay =
    isContentConcealed('mobile_phone') && !isContentRevealed('mobile_phone') ? CONTENT_MASK : card.mobilePhone ?? '';
  const passwordDisplay = hasPassword ? (detailActions.showPassword ? card.password : CONTENT_MASK) : '';

  return (
    <>
      {hasTitle && (
        <div className="detail-field">
          <div className="detail-label">{t('label.title')}</div>
          <div className="detail-value-box" onContextMenu={(event) => onOpenCoreMenu('title', event)}>
            <div className="detail-value-text">{titleDisplay}</div>
            {isContentConcealed('title') && (
              <div className="detail-value-actions">
                <DetailContentVisibilityButton
                  isRevealed={isContentRevealed('title')}
                  onToggle={() => onToggleContentReveal('title')}
                  t={t}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {hasUrl && (
        <div className="detail-field">
          <div className="detail-label">{t('label.url')}</div>
          <div className="detail-value-box" onContextMenu={(event) => onOpenCoreMenu('url', event)}>
            <div className="detail-value-text">{urlDisplay}</div>
            <div className="detail-value-actions">
              <button
                className="icon-button"
                type="button"
                aria-label={t('action.copy')}
                title={tTip('action.copy')}
                onClick={() => detailActions.copyToClipboard(card.url)}
              >
                <IconCopy />
              </button>
              {isContentConcealed('url') && (
                <DetailContentVisibilityButton
                  isRevealed={isContentRevealed('url')}
                  onToggle={() => onToggleContentReveal('url')}
                  t={t}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {hasEmail && (
        <div className="detail-field">
          <div className="detail-label">{t('label.email')}</div>
          <div className="detail-value-box" onContextMenu={(event) => onOpenCoreMenu('email', event)}>
            <div className="detail-value-text">{emailDisplay}</div>
            <div className="detail-value-actions">
              <button
                className="icon-button"
                type="button"
                aria-label={t('action.copy')}
                title={tTip('action.copy')}
                onClick={() => detailActions.copyToClipboard(card.email)}
              >
                <IconCopy />
              </button>
              {isContentConcealed('email') && (
                <DetailContentVisibilityButton
                  isRevealed={isContentRevealed('email')}
                  onToggle={() => onToggleContentReveal('email')}
                  t={t}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {hasRecoveryEmail && (
        <div className="detail-field">
          <div className="detail-label">{t('label.recoveryEmail')}</div>
          <div className="detail-value-box" onContextMenu={(event) => onOpenPreviewMenu('recovery_email', event, true)}>
            <div className="detail-value-text">{recoveryEmailDisplay}</div>
            <div className="detail-value-actions">
              <button
                className="icon-button"
                type="button"
                aria-label={t('action.copy')}
                title={tTip('action.copy')}
                onClick={() => detailActions.copyToClipboard(card.recoveryEmail)}
              >
                <IconCopy />
              </button>
              {isContentConcealed('recovery_email') && (
                <DetailContentVisibilityButton
                  isRevealed={isContentRevealed('recovery_email')}
                  onToggle={() => onToggleContentReveal('recovery_email')}
                  t={t}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {hasUsername && (
        <div className="detail-field">
          <div className="detail-label">{t('label.username')}</div>
          <div className="detail-value-box" onContextMenu={(event) => onOpenPreviewMenu('username', event, true)}>
            <div className="detail-value-text">{usernameDisplay}</div>
            <div className="detail-value-actions">
              <button
                className="icon-button"
                type="button"
                aria-label={t('action.copy')}
                title={tTip('action.copy')}
                onClick={() => detailActions.copyToClipboard(card.username)}
              >
                <IconCopy />
              </button>
              {isContentConcealed('username') && (
                <DetailContentVisibilityButton
                  isRevealed={isContentRevealed('username')}
                  onToggle={() => onToggleContentReveal('username')}
                  t={t}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {hasMobilePhone && (
        <div className="detail-field">
          <div className="detail-label">{t('label.mobile')}</div>
          <div className="detail-value-box" onContextMenu={(event) => onOpenPreviewMenu('mobile_phone', event, true)}>
            <div className="detail-value-text">{mobilePhoneDisplay}</div>
            <div className="detail-value-actions">
              <button
                className="icon-button"
                type="button"
                aria-label={t('action.copy')}
                title={tTip('action.copy')}
                onClick={() => detailActions.copyToClipboard(card.mobilePhone)}
              >
                <IconCopy />
              </button>
              {isContentConcealed('mobile_phone') && (
                <DetailContentVisibilityButton
                  isRevealed={isContentRevealed('mobile_phone')}
                  onToggle={() => onToggleContentReveal('mobile_phone')}
                  t={t}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {hasPassword && (
        <div className="detail-field">
          <div className="detail-label">{t('label.password')}</div>
          <div className="detail-value-box">
            <div className="detail-value-text">{passwordDisplay}</div>
            <div className="detail-value-actions">
              <button
                className="icon-button"
                type="button"
                aria-label={t('action.copy')}
                title={tTip('action.copy')}
                onClick={() => detailActions.copyToClipboard(card.password, { isSecret: true })}
              >
                <IconCopy />
              </button>
              <button
                className="icon-button"
                type="button"
                aria-label={detailActions.showPassword ? t('action.hide') : t('action.reveal')}
                title={detailActions.showPassword ? tTip('action.hide') : tTip('action.reveal')}
                onClick={detailActions.togglePasswordVisibility}
              >
                {detailActions.showPassword ? <IconPreviewOff /> : <IconPreview />}
              </button>
              <button
                className="icon-button"
                type="button"
                aria-label={t('action.passwordHistory')}
                title={tTip('action.passwordHistory')}
                onClick={onOpenHistory}
              >
                <IconHistory />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
