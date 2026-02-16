import React from 'react';
import { IconCopy } from '@/shared/icons/lucide/icons';
import type { UseDetailsResult } from '../useDetails';

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

type TwoFactorSectionProps = {
  totpUri: string | null | undefined;
  totpData: { token: string; remaining: number } | null;
  detailActions: UseDetailsResult;
  t: TranslateFn;
};

export function TwoFactorSection({ totpUri, totpData, detailActions, t }: TwoFactorSectionProps) {
  if (!totpUri) return null;

  return (
    <div className="detail-field">
      <div className="detail-label">{t('label.totp')}</div>

      <div className="detail-value-box">
        <div className="detail-value-text" style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: 2 }}>
            {totpData ? totpData.token : t('totp.invalid')}
          </span>

          {totpData && (
            <span className="muted" style={{ fontSize: 12 }}>
              {t('totp.expiresIn', { seconds: totpData.remaining })}
            </span>
          )}
        </div>

        {totpData && (
          <div className="detail-value-actions">
            <button
              className="icon-button"
              type="button"
              aria-label={t('action.copy')}
              onClick={() => detailActions.copyToClipboard(totpData.token, { isSecret: true })}
            >
              <IconCopy />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
