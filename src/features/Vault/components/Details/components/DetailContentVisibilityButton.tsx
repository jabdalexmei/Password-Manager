import React from 'react';
import { IconPreview, IconPreviewOff } from '@/shared/icons/lucide/icons';
import { useTranslation } from '../../../../../shared/lib/i18n';

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

type DetailContentVisibilityButtonProps = {
  isRevealed: boolean;
  onToggle: () => void;
  t: TranslateFn;
};

export function DetailContentVisibilityButton({
  isRevealed,
  onToggle,
  t,
}: DetailContentVisibilityButtonProps) {
  const { t: tTip } = useTranslation('Tooltips');

  return (
    <button
      className="icon-button"
      type="button"
      aria-label={isRevealed ? t('action.hide') : t('action.reveal')}
      title={isRevealed ? tTip('action.hide') : tTip('action.reveal')}
      onClick={onToggle}
    >
      {isRevealed ? <IconPreviewOff /> : <IconPreview />}
    </button>
  );
}
