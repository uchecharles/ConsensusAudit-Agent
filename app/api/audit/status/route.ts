// app/api/audit/status/route.ts
// Verifies, from chain data, that a transaction hash really is a finalized, successful
// submit_audit / file_appeal call to OUR contract for the given submission id. Only then is
// the verdict reported as a GenLayer consensus result. Anything else is "UNVERIFIED".
import { NextResponse } from 'next/server';
import { getReadClient, GENLAYER_CONTRACT_ADDRESS } from '@/lib/genlayer';
import { verifyAuditTx } from '@/lib/onchain-audit';
import { normalizeVerdict } from '@/lib/verdict';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const hash = searchParams.get('hash') ?? '';
  const submissionId = searchParams.get('submissionId') ?? '';

  if (!/^0x[a-fA-F0-9]{64}$/.test(hash) || !submissionId || submissionId.length > 128) {
    return NextResponse.json({ error: 'Provide a valid transaction hash and submissionId.' }, { status: 400 });
  }

  const client = getReadClient();
  const fn = submissionId.startsWith('appeal_') ? 'file_appeal' : 'submit_audit';

  try {
    const { verdict: onchain } = await verifyAuditTx(client, hash, submissionId, fn, { requireCalldata: true });
    return NextResponse.json({
      status: 'FINALIZED',
      verdict: {
        ...normalizeVerdict(onchain),
        mode: 'genlayer-consensus',
        contractAddress: GENLAYER_CONTRACT_ADDRESS,
        submissionId,
        txHash: hash,
        isAppeal: Boolean(onchain.is_appeal),
        previousVerdictHash: onchain.previous_id || null,
        appealDepth: Number(onchain.appeal_depth ?? 0),
        submitter: onchain.submitter,
        repoUrl: onchain.repo_url,
        commitSha: onchain.commit_sha,
        contentHash: onchain.content_hash,
        scopeHash: onchain.scope_hash,
        contentHashVerifiedOnChain: Boolean(onchain.content_hash_verified)
      }
    });
  } catch (error: any) {
    const msg = String(error?.message || error);
    // Not-yet-finalized is a normal state, not a failure.
    if (/not finalized yet/i.test(msg)) return NextResponse.json({ status: 'PENDING' });
    return NextResponse.json({ status: 'UNVERIFIED', reason: msg }, { status: 422 });
  }
}
