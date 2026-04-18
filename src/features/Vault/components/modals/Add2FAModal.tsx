import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from '../../../../shared/lib/i18n';
import { normalizeTotpInput } from '../../utils/totp';
import { decodeQrFromCanvas, decodeQrFromImageFile } from '../../../../shared/lib/zxingLoader';

type Props = {
  isOpen: boolean;
  existingUri: string | null;
  defaults: { issuer: string; label: string };
  onCancel: () => void;
  onSave: (uri: string) => void;
  onRemove: () => void;
};

type QrMessage = {
  type: 'error' | 'success';
  text: string;
};

type SelectionRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type Point = {
  x: number;
  y: number;
};

export const Add2FAModal: React.FC<Props> = ({
  isOpen,
  existingUri,
  defaults,
  onCancel,
  onSave,
  onRemove,
}) => {
  const { t } = useTranslation('DataCards');
  const { t: tCommon } = useTranslation('Common');
  const [tab, setTab] = useState<'text' | 'qr'>('text');
  const [textValue, setTextValue] = useState(existingUri ?? '');
  const [textError, setTextError] = useState<string | null>(null);
  const [qrMessage, setQrMessage] = useState<QrMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const [qrFileName, setQrFileName] = useState<string>(t('twoFactor.qr.noFileChosen'));
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selection, setSelection] = useState<SelectionRect | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const wasOpenRef = React.useRef(false);
  const previewImageRef = React.useRef<HTMLImageElement | null>(null);
  const selectionStartRef = React.useRef<Point | null>(null);

  const canRemove = useMemo(() => (existingUri ?? '').trim().length > 0, [existingUri]);
  const canScanSelected = useMemo(
    () => Boolean(selection && selection.width > 0 && selection.height > 0),
    [selection]
  );
  const canAdd = useMemo(() => {
    const trimmed = textValue.trim();
    if (!trimmed) return false;
    return normalizeTotpInput(trimmed, defaults).ok;
  }, [defaults, textValue]);

  const clearSelectionState = useCallback(() => {
    setSelectionMode(false);
    setSelection(null);
    setIsSelecting(false);
    selectionStartRef.current = null;
  }, []);

  const clearQrState = useCallback(() => {
    setQrFileName(t('twoFactor.qr.noFileChosen'));
    setPreviewUrl(null);
    setQrMessage(null);
    clearSelectionState();
  }, [clearSelectionState, t]);

  useEffect(() => {
    if (!previewUrl) return undefined;
    return () => {
      URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = isOpen;

    if (!wasOpen && isOpen) {
      setTextValue(existingUri ?? '');
      setTextError(null);
      setTab('text');
      setBusy(false);
      clearQrState();
    }
  }, [clearQrState, existingUri, isOpen]);

  const getPointFromClient = useCallback((clientX: number, clientY: number): Point | null => {
    const image = previewImageRef.current;
    if (!image) return null;

    const rect = image.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    return {
      x: Math.min(Math.max(clientX - rect.left, 0), rect.width),
      y: Math.min(Math.max(clientY - rect.top, 0), rect.height),
    };
  }, []);

  const updateSelectionByPoint = useCallback(
    (clientX: number, clientY: number) => {
      const start = selectionStartRef.current;
      if (!start) return;

      const current = getPointFromClient(clientX, clientY);
      if (!current) return;

      setSelection({
        x: Math.min(start.x, current.x),
        y: Math.min(start.y, current.y),
        width: Math.abs(current.x - start.x),
        height: Math.abs(current.y - start.y),
      });
    },
    [getPointFromClient]
  );

  useEffect(() => {
    if (!isSelecting) return undefined;

    const handleMouseMove = (event: MouseEvent) => {
      updateSelectionByPoint(event.clientX, event.clientY);
    };

    const handleMouseUp = (event: MouseEvent) => {
      updateSelectionByPoint(event.clientX, event.clientY);
      setIsSelecting(false);
      selectionStartRef.current = null;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isSelecting, updateSelectionByPoint]);

  if (!isOpen) return null;

  const applyDecodedValue = (rawValue: string, showSuccessMessage: boolean) => {
    const result = normalizeTotpInput(rawValue, defaults);
    if (result.ok === false) {
      setTextValue('');
      setQrMessage({ type: 'error', text: t(`twoFactor.error.${result.error}`) });
      return false;
    }

    setTextValue(result.uri);
    setTextError(null);
    setQrMessage(showSuccessMessage ? { type: 'success', text: t('twoFactor.qr.decodeSuccess') } : null);
    return true;
  };

  const handleSaveText = () => {
    setTextError(null);
    if (!textValue.trim()) {
      onRemove();
      return;
    }
    const result = normalizeTotpInput(textValue, defaults);
    if (result.ok === false) {
      setTextError(t(`twoFactor.error.${result.error}`));
      return;
    }
    onSave(result.uri);
  };

  const handleQrFile = async (file: File) => {
    setTextValue('');
    setTextError(null);
    setQrMessage(null);
    setBusy(true);
    try {
      const text = await decodeQrFromImageFile(file);
      applyDecodedValue(text, true);
    } catch (err) {
      console.error('[2FA] Failed to decode QR image', err);
      setQrMessage({ type: 'error', text: t('twoFactor.error.QR_DECODE_FAILED') });
    } finally {
      setBusy(false);
    }
  };

  const handleScanArea = () => {
    if (!previewUrl || busy) return;
    setSelectionMode(true);
    setSelection(null);
    setQrMessage(null);
  };

  const handlePreviewMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!selectionMode || busy) return;

    const start = getPointFromClient(event.clientX, event.clientY);
    if (!start) return;

    event.preventDefault();
    selectionStartRef.current = start;
    setSelection({ x: start.x, y: start.y, width: 0, height: 0 });
    setIsSelecting(true);
  };

  const handleScanSelected = async () => {
    if (!canScanSelected || busy) return;

    const image = previewImageRef.current;
    if (!image || !selection) return;

    setTextValue('');

    const renderedWidth = image.clientWidth;
    const renderedHeight = image.clientHeight;
    const naturalWidth = image.naturalWidth;
    const naturalHeight = image.naturalHeight;

    if (renderedWidth <= 0 || renderedHeight <= 0 || naturalWidth <= 0 || naturalHeight <= 0) {
      setQrMessage({ type: 'error', text: t('twoFactor.error.QR_DECODE_FAILED') });
      return;
    }

    const scaleX = naturalWidth / renderedWidth;
    const scaleY = naturalHeight / renderedHeight;

    const cropX = Math.max(0, Math.floor(selection.x * scaleX));
    const cropY = Math.max(0, Math.floor(selection.y * scaleY));
    const cropWidth = Math.min(Math.max(1, Math.floor(selection.width * scaleX)), naturalWidth - cropX);
    const cropHeight = Math.min(Math.max(1, Math.floor(selection.height * scaleY)), naturalHeight - cropY);

    if (cropWidth <= 0 || cropHeight <= 0) {
      setQrMessage({ type: 'error', text: t('twoFactor.error.QR_DECODE_FAILED') });
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = cropWidth;
    canvas.height = cropHeight;

    const context = canvas.getContext('2d');
    if (!context) {
      setQrMessage({ type: 'error', text: t('twoFactor.error.QR_DECODE_FAILED') });
      return;
    }

    context.drawImage(image, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);

    setBusy(true);
    setQrMessage(null);

    try {
      const text = await decodeQrFromCanvas(canvas);
      applyDecodedValue(text, true);
    } catch (err) {
      console.error('[2FA] Failed to decode selected QR area', err);
      setQrMessage({ type: 'error', text: t('twoFactor.error.QR_DECODE_FAILED') });
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = () => {
    setTextValue('');
    setTextError(null);
    setTab('text');
    setQrMessage(null);
    clearQrState();
  };

  return (
    <div
      className="dialog-backdrop dialog-backdrop--inner"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="add2fa-title">
        <button
          className="dialog-close dialog-close--topright"
          type="button"
          aria-label={tCommon('action.close')}
          onClick={onCancel}
        >
          {'\u00D7'}
        </button>
        <div className="dialog-header">
          <h2 id="add2fa-title" className="dialog-title">
            {t('twoFactor.title')}
          </h2>
        </div>

        <div className="dialog-body">
          <div className="button-row" style={{ marginBottom: 12 }}>
            <button
              className={`btn ${tab === 'text' ? 'btn-primary' : 'btn-secondary'}`}
              type="button"
              onClick={() => setTab('text')}
            >
              {t('twoFactor.tab.text')}
            </button>
            <button
              className={`btn ${tab === 'qr' ? 'btn-primary' : 'btn-secondary'}`}
              type="button"
              onClick={() => setTab('qr')}
            >
              {t('twoFactor.tab.qr')}
            </button>
          </div>

          {tab === 'text' ? (
            <div className="form-field">
              <label className="form-label" htmlFor="totp-text">
                {t('twoFactor.text.label')}
              </label>
              <textarea
                id="totp-text"
                className="textarea"
                value={textValue}
                placeholder={t('twoFactor.text.placeholder')}
                onChange={(e) => {
                  setTextValue(e.target.value);
                  setTextError(null);
                }}
              />
              {textError && <div className="form-error">{textError}</div>}
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                {t('twoFactor.text.hint')}
              </div>
            </div>
          ) : (
            <div className="form-field">
              <label className="form-label" htmlFor="totp-qr">
                {t('twoFactor.qr.label')}
              </label>
              <div className="file-picker">
                <input
                  id="totp-qr"
                  className="visually-hidden"
                  type="file"
                  accept="image/*"
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.currentTarget.files?.[0];
                    if (!file) return;

                    setQrFileName(file.name);
                    setPreviewUrl(URL.createObjectURL(file));
                    clearSelectionState();
                    setQrMessage(null);

                    void handleQrFile(file);

                    e.currentTarget.value = '';
                  }}
                />
                <div className="input file-picker__name" title={qrFileName}>
                  {qrFileName}
                </div>

                <label
                  htmlFor="totp-qr"
                  className="btn btn-secondary file-picker__btn"
                  aria-disabled={busy ? 'true' : 'false'}
                >
                  {t('twoFactor.qr.chooseFile')}
                </label>
              </div>
              {previewUrl && (
                <div style={{ marginTop: 12 }}>
                  <div
                    style={{
                      position: 'relative',
                      border: '1px solid var(--sem-border-default)',
                      borderRadius: 8,
                      overflow: 'hidden',
                      cursor: selectionMode ? 'crosshair' : 'default',
                      userSelect: 'none',
                    }}
                    onMouseDown={handlePreviewMouseDown}
                  >
                    <img
                      ref={previewImageRef}
                      src={previewUrl}
                      alt={t('twoFactor.qr.label')}
                      draggable={false}
                      style={{ display: 'block', width: '100%', height: 'auto' }}
                    />
                    {selection && (
                      <div
                        style={{
                          position: 'absolute',
                          left: selection.x,
                          top: selection.y,
                          width: selection.width,
                          height: selection.height,
                          border: '2px solid var(--sem-accent-primary)',
                          background: 'var(--sem-state-primary-soft)',
                          pointerEvents: 'none',
                        }}
                      />
                    )}
                  </div>
                </div>
              )}
              <div className="button-row" style={{ marginTop: 12 }}>
                <button className="btn btn-secondary" type="button" onClick={handleScanArea} disabled={!previewUrl || busy}>
                  {t('twoFactor.qr.scanArea')}
                </button>
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => {
                    void handleScanSelected();
                  }}
                  disabled={!canScanSelected || busy}
                >
                  {t('twoFactor.qr.scanSelected')}
                </button>
              </div>
              {qrMessage && (
                <div
                  className={`twofa-qr-message twofa-qr-message--${qrMessage.type}`}
                >
                  {qrMessage.text}
                </div>
              )}
              <div className="file-picker__status muted" aria-live="polite">
                {busy ? t('twoFactor.qr.loading') : '\u00A0'}
              </div>
            </div>
          )}
        </div>

        <div className="dialog-footer dialog-footer--split">
          <div className="dialog-footer-left">
            <button className="btn btn-secondary" type="button" onClick={onCancel}>
              {t('action.cancel')}
            </button>
            {canRemove && (
              <button className="btn btn-danger" type="button" onClick={handleRemove}>
                {t('twoFactor.remove')}
              </button>
            )}
          </div>
          <div className="dialog-footer-right">
            <button className="btn btn-primary" type="button" onClick={handleSaveText} disabled={!canAdd}>
              {t('action.add')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
