// lib/audit-auth.ts
// Wallet-signed audit requests (EIP-191 personal_sign). The signed text spells out
// the action and every value the audit is bound to, so a signature cannot be reused
// for different content, a different commit, a different scope or a different appeal.
import { verifyMessage } from 'ethers';
import { GENLAYER_CHAIN_ID, GENLAYER_CONTRACT_ADDRESS } from './contract-public';
import type { Bundle } from './binding';
import { sha256Hex } from './binding';

export const REQUEST_TTL_MS = 10 * 60 * 1000;
export const NONCE_RE = /^[0-9a-f]{32}$/;
const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

export type AuthFields = {
  action: 'audit' | 'appeal';
  wallet: string;
  nonce: string;
  issuedAt: number; // ms
  expiresAt: number; // ms
};

export function submissionIdFor(action: 'audit' | 'appeal', nonce: string): string {
  return `${action}_${nonce}`;
}

export function buildAuthMessage(
  f: AuthFields,
  bundle: Bundle,
  priorSubmissionId: string | null,
  rebuttal: string | null
): string {
  return [
    'ConsensusAudit request',
    `action: ${f.action}`,
    `chain: ${GENLAYER_CHAIN_ID}`,
    `contract: ${GENLAYER_CONTRACT_ADDRESS.toLowerCase()}`,
    `wallet: ${f.wallet.toLowerCase()}`,
    `submission_id: ${submissionIdFor(f.action, f.nonce)}`,
    `repo_url: ${bundle.repoUrl}`,
    `commit_sha: ${bundle.commitSha || '(pasted code)'}`,
    `content_sha256: ${bundle.contentHash}`,
    `scope_sha256: ${bundle.scopeHash}`,
    `prior_submission_id: ${priorSubmissionId ?? '-'}`,
    `rebuttal_sha256: ${rebuttal ? sha256Hex(rebuttal) : '-'}`,
    `nonce: ${f.nonce}`,
    `issued_at: ${new Date(f.issuedAt).toISOString()}`,
    `expires_at: ${new Date(f.expiresAt).toISOString()}`
  ].join('\n');
}

export function newAuthFields(action: 'audit' | 'appeal', wallet: string): AuthFields {
  const now = Date.now();
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join('');
  return { action, wallet, nonce, issuedAt: now, expiresAt: now + REQUEST_TTL_MS };
}

/** Returns the verified lowercase wallet, or throws with a user-readable reason. */
export function verifyAuth(
  f: AuthFields,
  signature: string,
  bundle: Bundle,
  priorSubmissionId: string | null,
  rebuttal: string | null
): string {
  if (!ADDR_RE.test(f.wallet)) throw new Error('Invalid wallet address.');
  if (!NONCE_RE.test(f.nonce)) throw new Error('Invalid nonce.');
  const now = Date.now();
  if (!Number.isFinite(f.expiresAt) || f.expiresAt < now) throw new Error('This signed request has expired. Sign again.');
  if (f.expiresAt - now > REQUEST_TTL_MS + 60_000) throw new Error('Signed request lifetime is too long.');

  const message = buildAuthMessage(f, bundle, priorSubmissionId, rebuttal);
  let recovered: string;
  try {
    recovered = verifyMessage(message, signature);
  } catch {
    throw new Error('Signature is malformed.');
  }
  if (recovered.toLowerCase() !== f.wallet.toLowerCase()) {
    throw new Error('Signature does not match the wallet, or the content/commit/scope changed since you signed.');
  }
  return f.wallet.toLowerCase();
}
