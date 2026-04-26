import { useCallback, useState } from 'react';
import {
  legacyImportDiscardPick,
  legacyImportFromPick,
  legacyImportPickCsv,
  type LegacyImportInspectDto,
  type LegacyImportResultDto,
} from '../api/vaultApi';

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;
type ToastFn = (message: string, tone?: 'success' | 'error' | 'info') => void;

type UseLegacyImportFlowsParams = {
  showToast: ToastFn;
  tCommon: TranslateFn;
  tVault: TranslateFn;
  onAfterImport: () => Promise<void>;
};

export function useLegacyImportFlows({
  showToast,
  tCommon,
  tVault,
  onAfterImport,
}: UseLegacyImportFlowsParams) {
  const [pendingImportToken, setPendingImportToken] = useState<string | null>(null);
  const [pendingImportLabel, setPendingImportLabel] = useState<string | null>(null);
  const [pendingImportInspect, setPendingImportInspect] = useState<LegacyImportInspectDto | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [lastImportResult, setLastImportResult] = useState<LegacyImportResultDto | null>(null);

  const handleImportError = useCallback(
    (err: any) => {
      const code = err?.code ?? err?.error ?? 'UNKNOWN';
      showToast(`${tCommon('error.operationFailed')} (${code})`, 'error');
    },
    [showToast, tCommon]
  );

  const handleImportLegacyData = useCallback(async () => {
    try {
      const picked = await legacyImportPickCsv();
      if (!picked) return;
      setPendingImportToken(picked.token);
      setPendingImportLabel(picked.fileName);
      setPendingImportInspect(picked.inspect);
    } catch (err) {
      handleImportError(err);
    }
  }, [handleImportError]);

  const handleConfirmImport = useCallback(async () => {
    if (!pendingImportToken) return;
    setIsImporting(true);
    try {
      const result = await legacyImportFromPick(pendingImportToken);
      await onAfterImport();
      setLastImportResult(result);
      setPendingImportToken(null);
      setPendingImportLabel(null);
      setPendingImportInspect(null);
      showToast(tVault('legacyImport.success'), 'success');
    } catch (err) {
      handleImportError(err);
    } finally {
      setIsImporting(false);
    }
  }, [handleImportError, onAfterImport, pendingImportToken, showToast, tVault]);

  const handleCloseImport = useCallback(() => {
    if (isImporting) return;
    if (pendingImportToken) {
      void legacyImportDiscardPick(pendingImportToken);
    }
    setPendingImportToken(null);
    setPendingImportLabel(null);
    setPendingImportInspect(null);
  }, [isImporting, pendingImportToken]);

  const handleCloseResult = useCallback(() => {
    setLastImportResult(null);
  }, []);

  return {
    pendingImportToken,
    pendingImportLabel,
    pendingImportInspect,
    isImporting,
    lastImportResult,
    handleImportLegacyData,
    handleConfirmImport,
    handleCloseImport,
    handleCloseResult,
  };
}
