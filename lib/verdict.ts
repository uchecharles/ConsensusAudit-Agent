// lib/verdict.ts
export type Verdict = {
  mode: string;
  status: 'APPROVED' | 'REJECTED';
  critical_count: number;
  high_count: number;
  findings: { type: string; severity: string; summary: string }[];
  submissionId: string;
  timestamp: string;
  isAppeal: boolean;
  previousVerdictHash: string | null;
  [key: string]: any;
};

const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
export const MAX_FINDINGS = 25;

/**
 * Single place where a raw model or contract result becomes a verdict.
 * Mirrors the contract's rules, and THROWS instead of coercing:
 *  - counts must be non-negative integers
 *  - every finding needs a known severity
 *  - reported critical/high counts must equal the severities in the findings
 *  - "criticals or highs mean REJECTED" is enforced here, in code
 */
export function normalizeVerdict(raw: any): Pick<Verdict, 'status' | 'critical_count' | 'high_count' | 'findings'> {
  const strictCount = (v: any, label: string) => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) throw new Error(`${label} must be a non-negative integer.`);
    return v;
  };
  const critical = strictCount(raw?.critical_count, 'critical_count');
  const high = strictCount(raw?.high_count, 'high_count');

  if (!Array.isArray(raw?.findings)) throw new Error('findings must be a list.');
  if (raw.findings.length > MAX_FINDINGS) throw new Error(`A verdict may contain at most ${MAX_FINDINGS} findings.`);

  let actualCritical = 0;
  let actualHigh = 0;
  const findings = raw.findings.map((f: any) => {
    if (!f || typeof f !== 'object') throw new Error('Every finding must be an object.');
    const sev = String(f.severity ?? '').trim().toUpperCase();
    if (!SEVERITIES.includes(sev)) throw new Error('Finding has an unknown severity.');
    if (sev === 'CRITICAL') actualCritical++;
    if (sev === 'HIGH') actualHigh++;
    return {
      type: String(f.type ?? 'Unspecified').slice(0, 200),
      severity: sev.charAt(0) + sev.slice(1).toLowerCase(),
      summary: String(f.summary ?? '').slice(0, 600)
    };
  });

  if (actualCritical !== critical || actualHigh !== high) {
    throw new Error(
      `Finding severities conflict with reported counts: claimed Critical=${critical}, High=${high}; ` +
      `findings contain Critical=${actualCritical}, High=${actualHigh}.`
    );
  }

  let status = String(raw?.status ?? 'REJECTED').trim().toUpperCase();
  if (status !== 'APPROVED' && status !== 'REJECTED') status = 'REJECTED';
  if (critical > 0 || high > 0) status = 'REJECTED';

  return { status: status as 'APPROVED' | 'REJECTED', critical_count: critical, high_count: high, findings };
}
