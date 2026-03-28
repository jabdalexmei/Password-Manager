import * as OTPAuth from 'otpauth';

export type NormalizeTotpResult = { ok: true; uri: string } | { ok: false; error: string };

const isLikelyOtpAuthUri = (value: string) => value.trim().toLowerCase().startsWith('otpauth://');

const normalizeBase32 = (value: string) => value.replace(/\s+/g, '').toUpperCase();

export function normalizeTotpInput(
  raw: string,
  defaults: { issuer: string; label: string }
): NormalizeTotpResult {
  const value = raw.trim();
  if (!value) return { ok: false, error: 'EMPTY' };

  if (isLikelyOtpAuthUri(value)) {
    try {
      const parsed = OTPAuth.URI.parse(value);
      if (!(parsed instanceof OTPAuth.TOTP)) return { ok: false, error: 'NOT_TOTP' };
      return { ok: true, uri: parsed.toString() };
    } catch {
      return { ok: false, error: 'INVALID_URI' };
    }
  }

  try {
    const secret = OTPAuth.Secret.fromBase32(normalizeBase32(value));
    const totp = new OTPAuth.TOTP({
      issuer: defaults.issuer,
      label: defaults.label,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret,
    });
    return { ok: true, uri: totp.toString() };
  } catch {
    return { ok: false, error: 'INVALID_SECRET' };
  }
}

export function generateTotpCode(uri: string, nowMs: number) {
  const parsed = OTPAuth.URI.parse(uri);
  if (!(parsed instanceof OTPAuth.TOTP)) {
    throw new Error('NOT_TOTP');
  }

  const token = parsed.generate({ timestamp: nowMs });
  const period = parsed.period ?? 30;
  const epoch = (parsed as unknown as { epoch?: number }).epoch ?? 0;

  const nowSec = Math.floor(nowMs / 1000);
  const remaining = period - ((nowSec - epoch) % period);

  return { token, period, remaining };
}
