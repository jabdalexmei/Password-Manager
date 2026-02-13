import React from 'react';
import { IconCopy, IconHistory, IconPreview, IconPreviewOff } from '@/shared/icons/lucide/icons';
import type { DataCard } from '../../../types/ui';
import type { DataCardCoreField } from '../../../lib/datacardCoreHiddenFields';
import type { UseDetailsResult } from '../useDetails';
import type { DataCardCardPreviewField } from '../lib/previewTokens';

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

type CoreFieldsSectionProps = {
  card: DataCard;
  detailActions: UseDetailsResult;
  onOpenCoreMenu: (field: DataCardCoreField, event: React.MouseEvent) => void;
  onOpenPreviewMenu: (field: DataCardCardPreviewField, event: React.MouseEvent, allowGlobal: boolean) => void;
  onOpenHistory: () => void;
  t: TranslateFn;
};

const SECRET_MASK = '\u2022'.repeat(12);

export function CoreFieldsSection({
  card,
  detailActions,
  onOpenCoreMenu,
  onOpenPreviewMenu,
  onOpenHistory,
  t,
}: CoreFieldsSectionProps) {
  const hasValue = (value?: string | null) => Boolean(value?.trim());
  const hasTitle = hasValue(card.title);
  const hasUrl = hasValue(card.url);
  const hasEmail = hasValue(card.email);
  const hasRecoveryEmail = hasValue(card.recoveryEmail);
  const hasUsername = hasValue(card.username);
  const hasMobilePhone = hasValue(card.mobilePhone);
  const hasPassword = hasValue(card.password);
  const passwordDisplay = hasPassword ? (detailActions.showPassword ? card.password : SECRET_MASK) : '';

  return (
    <>
      {hasTitle && (
        <div className="detail-field">
          <div className="detail-label">{t('label.title')}</div>
          <div className="detail-value-box" onContextMenu={(event) => onOpenCoreMenu('title', event)}>
            <div className="detail-value-text">{card.title}</div>
          </div>
        </div>
      )}

      {hasUrl && (
        <div className="detail-field">
          <div className="detail-label">{t('label.url')}</div>
          <div className="detail-value-box" onContextMenu={(event) => onOpenCoreMenu('url', event)}>
            <div className="detail-value-text">{card.url ?? ''}</div>
            <div className="detail-value-actions">
              <button
                className="icon-button"
                type="button"
                aria-label={t('action.copy')}
                onClick={() => detailActions.copyToClipboard(card.url)}
              >
                <IconCopy />
              </button>
            </div>
          </div>
        </div>
      )}

      {hasEmail && (
        <div className="detail-field">
          <div className="detail-label">{t('label.email')}</div>
          <div className="detail-value-box" onContextMenu={(event) => onOpenCoreMenu('email', event)}>
            <div className="detail-value-text">{card.email ?? ''}</div>
            <div className="detail-value-actions">
              <button
                className="icon-button"
                type="button"
                aria-label={t('action.copy')}
                onClick={() => detailActions.copyToClipboard(card.email)}
              >
                <IconCopy />
              </button>
            </div>
          </div>
        </div>
      )}

      {hasRecoveryEmail && (
        <div className="detail-field">
          <div className="detail-label">{t('label.recoveryEmail')}</div>
          <div className="detail-value-box" onContextMenu={(event) => onOpenPreviewMenu('recovery_email', event, true)}>
            <div className="detail-value-text">{card.recoveryEmail ?? ''}</div>
            <div className="detail-value-actions">
              <button
                className="icon-button"
                type="button"
                aria-label={t('action.copy')}
                onClick={() => detailActions.copyToClipboard(card.recoveryEmail)}
              >
                <IconCopy />
              </button>
            </div>
          </div>
        </div>
      )}

      {hasUsername && (
        <div className="detail-field">
          <div className="detail-label">{t('label.username')}</div>
          <div className="detail-value-box" onContextMenu={(event) => onOpenPreviewMenu('username', event, true)}>
            <div className="detail-value-text">{card.username ?? ''}</div>
            <div className="detail-value-actions">
              <button
                className="icon-button"
                type="button"
                aria-label={t('action.copy')}
                onClick={() => detailActions.copyToClipboard(card.username)}
              >
                <IconCopy />
              </button>
            </div>
          </div>
        </div>
      )}

      {hasMobilePhone && (
        <div className="detail-field">
          <div className="detail-label">{t('label.mobile')}</div>
          <div className="detail-value-box" onContextMenu={(event) => onOpenPreviewMenu('mobile_phone', event, true)}>
            <div className="detail-value-text">{card.mobilePhone ?? ''}</div>
            <div className="detail-value-actions">
              <button
                className="icon-button"
                type="button"
                aria-label={t('action.copy')}
                onClick={() => detailActions.copyToClipboard(card.mobilePhone)}
              >
                <IconCopy />
              </button>
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
                aria-label={detailActions.showPassword ? t('action.hide') : t('action.reveal')}
                onClick={detailActions.togglePasswordVisibility}
              >
                {detailActions.showPassword ? <IconPreviewOff /> : <IconPreview />}
              </button>
              <button
                className="icon-button"
                type="button"
                aria-label={t('action.copy')}
                onClick={() => detailActions.copyToClipboard(card.password, { isSecret: true })}
              >
                <IconCopy />
              </button>
              <button className="icon-button" type="button" aria-label={t('action.passwordHistory')} onClick={onOpenHistory}>
                <IconHistory />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
