import { useEffect, useMemo, useState } from 'react';
import { generateTotpCode } from '../../../utils/totp';

export function useTotpTicker(totpUri: string | null | undefined) {
  const [totpNow, setTotpNow] = useState(() => Date.now());

  const totpData = useMemo(() => {
    const uri = totpUri?.trim();
    if (!uri) return null;

    try {
      return generateTotpCode(uri, totpNow);
    } catch {
      return null;
    }
  }, [totpNow, totpUri]);

  useEffect(() => {
    const uri = totpUri?.trim();
    if (!uri) return;

    const id = window.setInterval(() => setTotpNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [totpUri]);

  return totpData;
}
