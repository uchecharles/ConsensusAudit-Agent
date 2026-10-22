// lib/onchain-audit.ts
// Relays an audit to the Intelligent Contract and, crucially, verifies afterwards that
// the finalized transaction really is that audit before anything is called "consensus".
import 'server-only';
import type { Bundle } from './binding';
import { resolveFees } from './genlayer-fees';
import { GENLAYER_CONTRACT_ADDRESS, NO_VALUE } from './genlayer';

export type VerifiedVerdict = {
  verdict: any; // raw on-chain verdict object
  txHash: string;
};

/** Every plausible byte decoding of a calldata-ish field (hex, base64, or raw text). */
function calldataBuffers(tx: any): Buffer[] {
  const out: Buffer[] = [];
  const seen = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v !== 'string' || !v.length || seen.has(v)) return;
    seen.add(v);
    out.push(Buffer.from(v, 'utf8'));
    const hex = v.startsWith('0x') ? v.slice(2) : v;
    if (/^[0-9a-fA-F]+$/.test(hex) && hex.length % 2 === 0) out.push(Buffer.from(hex, 'hex'));
    if (/^[A-Za-z0-9+/=_-]+$/.test(v)) {
      try { out.push(Buffer.from(v, 'base64')); } catch { /* not base64 */ }
    }
  };
  for (const c of [tx?.data?.calldata, tx?.data, tx?.txData, tx?.txCalldata, tx?.input]) {
    if (typeof c === 'string') add(c);
    else if (c && typeof c === 'object') for (const v of Object.values(c)) add(v);
  }
  return out;
}

/** true / false when calldata could be searched, null when this tx exposes no usable calldata. */
function calldataMentions(tx: any, needles: string[]): boolean | null {
  const bufs = calldataBuffers(tx);
  if (bufs.length === 0) return null;
  return bufs.some(buf => needles.every(n => buf.includes(Buffer.from(n, 'utf8'))));
}

/**
 * Checks, from chain data only, that `hash` is a finalized, successful call to OUR
 * contract's `fn` for `submissionId`, and that the stored verdict belongs to it.
 */
export async function verifyAuditTx(
  client: any,
  hash: string,
  submissionId: string,
  fn: 'submit_audit' | 'file_appeal',
  opts: { requireCalldata?: boolean } = {}
): Promise<VerifiedVerdict> {
  const tx: any = await client.getTransaction({ hash: hash as `0x${string}` });
  if (!tx) throw new Error('Transaction not found.');

  const status = String(tx.statusName ?? '').toUpperCase();
  if (status !== 'FINALIZED') throw new Error(`Transaction is not finalized yet (status: ${status || 'unknown'}).`);

  const to = String(tx.to_address ?? tx.recipient ?? '').toLowerCase();
  if (to !== GENLAYER_CONTRACT_ADDRESS.toLowerCase()) {
    throw new Error('Transaction was not sent to the ConsensusAudit contract.');
  }

  const exec = String(tx.txExecutionResultName ?? '');
  if (exec && exec !== 'FINISHED_WITH_RETURN') throw new Error(`Transaction execution did not succeed (${exec}).`);

  // Calldata check when the node exposes it. A tx hash we just created ourselves skips the
  // requirement (it is inherently the one we sent), but a mismatch is always fatal.
  const mentions = calldataMentions(tx, [fn, submissionId]);
  if (mentions === false) throw new Error(`Transaction is not a ${fn} call for this submission id.`);
  if (mentions === null && opts.requireCalldata) {
    throw new Error('This node does not expose the transaction calldata, so the call cannot be verified from the hash alone.');
  }

  const raw = (await client.readContract({
    address: GENLAYER_CONTRACT_ADDRESS,
    functionName: 'get_verdict',
    args: [submissionId]
  })) as string;
  if (!raw) throw new Error('No verdict is stored for this submission id.');
  const verdict = JSON.parse(raw);
  if (verdict.submission_id !== submissionId) throw new Error('Stored verdict does not carry this submission id.');
  // The contract records the tx sender as submitted_via, tying the verdict to this transaction's sender.
  const sender = String(tx.from_address ?? tx.sender ?? '').toLowerCase();
  if (sender && String(verdict.submitted_via ?? '').toLowerCase() !== sender) {
    throw new Error('The stored verdict was not submitted by this transaction\'s sender.');
  }

  // Re-apply the severity rule off-chain too; never trust stored counts blindly.
  const counted = { critical: 0, high: 0 };
  for (const f of verdict.findings ?? []) {
    const s = String(f?.severity ?? '').toUpperCase();
    if (s === 'CRITICAL') counted.critical++;
    else if (s === 'HIGH') counted.high++;
  }
  if (counted.critical !== Number(verdict.critical_count) || counted.high !== Number(verdict.high_count)) {
    throw new Error('Stored verdict has finding severities that conflict with its reported counts.');
  }
  return { verdict, txHash: hash };
}

export type RelayInput = {
  submissionId: string;
  /** Verified wallet to record as submitter, or null to record the relayer itself. */
  wallet: string | null;
  bundle: Bundle;
  priorSubmissionId?: string;
  rebuttal?: string;
};

export async function relayAudit(client: any, input: RelayInput): Promise<VerifiedVerdict & { fn: string }> {
  const { submissionId, wallet, bundle, priorSubmissionId, rebuttal } = input;
  const isAppeal = Boolean(priorSubmissionId);
  const fn = isAppeal ? 'file_appeal' : 'submit_audit';

  if (wallet) {
    const relayer = String(
      await client.readContract({ address: GENLAYER_CONTRACT_ADDRESS, functionName: 'get_relayer', args: [] })
    ).toLowerCase();
    const me = String(client.account?.address ?? '').toLowerCase();
    if (!relayer || relayer !== me) {
      throw new Error(
        `The server relayer (${me || 'unconfigured'}) is not registered on the contract. The contract owner must call set_relayer(${me}) first.`
      );
    }
  }

  const common = [wallet ?? '', bundle.repoUrl, bundle.commitSha, bundle.contentHash, bundle.scopeManifest, bundle.payload];
  const args = isAppeal
    ? [priorSubmissionId, submissionId, ...common, String(rebuttal ?? '')]
    : [submissionId, ...common];

  const payload = { address: GENLAYER_CONTRACT_ADDRESS, functionName: fn, args, value: NO_VALUE };
  const fees = await resolveFees(client, payload);

  const txHash = await client.writeContract({ ...payload, ...(fees ? { fees } : {}) });
  const receipt: any = await client.waitForTransactionReceipt({
    hash: txHash,
    waitUntil: 'finalized',
    interval: 5000,
    retries: 50
  });
  const exec = String(receipt?.txExecutionResultName ?? '');
  if (receipt?.status === 'reverted' || (exec && exec !== 'FINISHED_WITH_RETURN')) {
    throw new Error(`The contract rejected this ${fn} (${exec || 'reverted'}).`);
  }

  const verified = await verifyAuditTx(client, txHash, submissionId, fn, { requireCalldata: false });

  // The stored binding must be exactly what we sent.
  const v = verified.verdict;
  const expected: Record<string, string> = {
    repo_url: bundle.repoUrl,
    commit_sha: bundle.commitSha,
    content_hash: bundle.contentHash,
    scope_manifest: bundle.scopeManifest
  };
  for (const [k, val] of Object.entries(expected)) {
    if (v[k] !== val) throw new Error(`On-chain verdict ${k} does not match the reviewed content.`);
  }
  if (wallet && String(v.submitter).toLowerCase() !== wallet.toLowerCase()) {
    throw new Error('On-chain submitter does not match the signing wallet.');
  }
  return { ...verified, fn };
}
