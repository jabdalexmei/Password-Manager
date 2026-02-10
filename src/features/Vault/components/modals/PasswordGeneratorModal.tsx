import React from 'react';
import { useTranslation } from '../../../../shared/lib/i18n';
import { calculateStrengthBits, PasswordGeneratorOptions } from '../../utils/passwordGenerator';
import { IconCopy, IconRegenerate } from '@/shared/icons/lucide/icons';

type PasswordGeneratorModalProps = {
  isOpen: boolean;
  options: PasswordGeneratorOptions;
  generatedPassword: string;
  charsetSize: number;
  onChangeOptions: (options: PasswordGeneratorOptions) => void;
  onClose: () => void;
  onUse: () => void;
  onRegenerate: () => void;
  onCopy: () => Promise<void>;
};

export const PasswordGeneratorModal: React.FC<PasswordGeneratorModalProps> = ({
  isOpen,
  options,
  charsetSize,
  generatedPassword,
  onChangeOptions,
  onClose,
  onUse,
  onRegenerate,
  onCopy,
}) => {
  const { t } = useTranslation('DataCards');

  if (!isOpen) return null;

  const bits = calculateStrengthBits(options.length, charsetSize);

  // The entropy model for the generator is: bits ~= length * log2(charsetSize).
  // Since we generate randomly, this is a decent UI proxy for "how hard to brute-force".
  // For human-chosen passwords, this model is NOT reliable.
  const strengthLabelKey =
    bits < 40 ? 'generator.strengthWeakLabel' : bits < 80 ? 'generator.strengthMediumLabel' : 'generator.strengthStrongLabel';

  // Meter calibration:
  // - Start showing fill after ~20 bits so tiny passwords don't look "half full".
  // - Consider 120+ bits as "full" (typical 20 chars from a large charset lands here).
  const minBitsForMeter = 20;
  const maxBitsForMeter = 120;
  const normalizedStrength = Math.min(1, Math.max(0, (bits - minBitsForMeter) / (maxBitsForMeter - minBitsForMeter)));

  // Make the early part of the scale visually "redder" (gamma curve).
  // hue: 0 = red, 120 = green (passing through orange in the middle).
  const strengthHue = Math.round(Math.pow(normalizedStrength, 1.6) * 120);

  const strengthFillStyle: React.CSSProperties = {
    width: `${normalizedStrength * 100}%`,
    backgroundColor: `hsl(${strengthHue}, 85%, 45%)`,
  };

  const handleCheckboxChange = (key: keyof PasswordGeneratorOptions) => (event: React.ChangeEvent<HTMLInputElement>) => {
    onChangeOptions({ ...options, [key]: event.target.checked });
  };

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="dialog generator-dialog" role="dialog" aria-modal="true" aria-labelledby="generator-title">
        <button className="dialog-close dialog-close--topright" type="button" aria-label="Close" onClick={onClose}>
          {'\u00D7'}
        </button>
        <div className="dialog-header">
          <h2 id="generator-title" className="dialog-title">
            {t('generator.title')}
          </h2>
        </div>

        <div className="dialog-body generator-body">
          <div className="generator-row">
            <label className="form-label" htmlFor="generated-password">
              {t('generator.generatedPassword')}
            </label>
            <div className="input-with-actions">
              <input id="generated-password" className="input" value={generatedPassword} readOnly />
              <div className="input-actions">
                <button
                  className="icon-button icon-button-primary"
                  type="button"
                  aria-label={t('generator.regenerate')}
                  onClick={onRegenerate}
                >
                  <IconRegenerate />
                </button>
                <button className="icon-button" type="button" aria-label={t('action.copy')} onClick={() => void onCopy()}>
                  <IconCopy />
                </button>
              </div>
            </div>
          </div>

          <div className="generator-strength-block">
            <div className="generator-strength-header">
              <span className="generator-strength-title">{t('generator.passwordStrength')}</span>
              <span className="generator-strength-value">{t(strengthLabelKey, { bits })}</span>
            </div>

            <div className="generator-strength-bar">
              <div className="generator-strength-fill" style={strengthFillStyle} />
            </div>
          </div>

          <div className="generator-row">
            <label className="form-label" htmlFor="length-slider">
              {t('generator.length')}: {options.length}
            </label>
            <input
              id="length-slider"
              type="range"
              min={6}
              max={32}
              value={options.length}
              onChange={(event) => onChangeOptions({ ...options, length: Number(event.target.value) })}
            />
          </div>

          <div className="generator-options">
            <label className="checkbox">
              <input type="checkbox" checked={options.lowercase} onChange={handleCheckboxChange('lowercase')} />
              <span>{t('generator.lowercase')}</span>
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={options.uppercase} onChange={handleCheckboxChange('uppercase')} />
              <span>{t('generator.uppercase')}</span>
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={options.numbers} onChange={handleCheckboxChange('numbers')} />
              <span>{t('generator.numbers')}</span>
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={options.symbols} onChange={handleCheckboxChange('symbols')} />
              <span>{t('generator.symbols')}</span>
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={options.excludeSimilar} onChange={handleCheckboxChange('excludeSimilar')} />
              <span>{t('generator.excludeSimilar')}</span>
            </label>
          </div>
        </div>

        <div className="dialog-footer">
          <button className="btn btn-secondary" type="button" onClick={onClose}>
            {t('action.cancel')}
          </button>
          <button className="btn btn-primary" type="button" onClick={onUse} disabled={!generatedPassword || charsetSize === 0}>
            {t('generator.use')}
          </button>
        </div>
      </div>
    </div>
  );
};
