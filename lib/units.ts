// lib/units.ts — client-safe GEN <-> wei helpers

export function genToWei(genAmount: string | number): bigint {
  const str = String(genAmount).trim();
  if (!str || Number.isNaN(Number(str))) return 0n;
  const negative = str.startsWith('-');
  const clean = negative ? str.slice(1) : str;
  const [whole, frac = ''] = clean.split('.');
  const wholeBig = BigInt(whole || '0');
  const fracPadded = (frac + '0'.repeat(18)).slice(0, 18);
  const fracBig = BigInt(fracPadded || '0');
  const wei = wholeBig * 10n ** 18n + fracBig;
  return negative ? -wei : wei;
}

export function weiToGen(weiAmount: string | number | bigint): string {
  try {
    const wei = BigInt(weiAmount);
    const whole = wei / 10n ** 18n;
    const frac = wei % 10n ** 18n;
    const fracStr = frac.toString().padStart(18, '0').replace(/0+$/, '');
    return fracStr ? `${whole}.${fracStr}` : whole.toString();
  } catch {
    return String(weiAmount);
  }
}