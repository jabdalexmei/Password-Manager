import React from 'react';
import { IconCopy } from '@/shared/icons/lucide/icons';
import { useTranslation } from '../../../../../shared/lib/i18n';
import { CONTENT_MASK } from '../../../lib/datacardDetailContentFields';
import type { UseDetailsResult } from '../useDetails';
import { DetailContentVisibilityButton } from '../components/DetailContentVisibilityButton';

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

type TwoFactorSectionProps = {
  totpUri: string | null | undefined;
  totpData: { token: string; remaining: number } | null;
  detailActions: UseDetailsResult;
  isContentConcealed: boolean;
  isContentRevealed: boolean;
  onToggleContentReveal: () => void;
  onOpenContentMenu: (event: React.MouseEvent) => void;
  t: TranslateFn;
};

export function TwoFactorSection({
  totpUri,
  totpData,
  detailActions,
  isContentConcealed,
  isContentRevealed,
  onToggleContentReveal,
  onOpenContentMenu,
  t,
}: TwoFactorSectionProps) {
  const { t: tTip } = useTranslation('Tooltips');
  if (!totpUri) return null;

  const tokenText = totpData ? totpData.token : t('totp.invalid');
  const displayToken = isContentConcealed && !isContentRevealed ? CONTENT_MASK : tokenText;
  const metaText = totpData ? t('totp.expiresIn', { seconds: totpData.remaining }) : null;

  return (
    <div className="detail-field">
      <div className="detail-label">{t('label.totp')}</div>

      <div className="detail-value-box" onContextMenu={onOpenContentMenu}>
        <div className="detail-value-text" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', rowGap: 4 }}>
          <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: 2 }}>
            {displayToken}
          </span>

          {metaText && (!isContentConcealed || isContentRevealed) && (
            <span className="muted" style={{ fontSize: 12 }}>
              {metaText}
            </span>
          )}
        </div>

        {(totpData || isContentConcealed) && (
          <div className="detail-value-actions">
            {totpData && (
              <button
                className="icon-button"
                type="button"
                aria-label={t('action.copy')}
                title={tTip('action.copy')}
                onClick={() => detailActions.copyToClipboard(totpData.token, { isSecret: true })}
              >
                <IconCopy />
              </button>
            )}
            {isContentConcealed && (
              <DetailContentVisibilityButton
                isRevealed={isContentRevealed}
                onToggle={onToggleContentReveal}
                t={t}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
