// app/api/webhook/route.ts
// GitHub PR gate backed by the ConsensusAudit Intelligent Contract.
//
//  * The request must carry a valid X-Hub-Signature-256 (GITHUB_WEBHOOK_SECRET). Anyone else gets 401.
//  * The PR head commit is pinned, hashed and submitted to the contract via submit_audit.
//  * A commit status is only ever "success" when the finalized on-chain verdict for THAT head
//    commit and content hash is APPROVED. If the chain is unreachable or the verdict cannot be
//    verified, the status is "error" (never a guessed pass, never an off-chain model verdict).
//  * The status text says exactly what it is, and links the submission id.
import { NextResponse, after } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { getGenLayerClient } from '@/lib/genlayer';
import { ingestGithubUrl, IngestError } from '@/lib/github-pin';
import { relayAudit } from '@/lib/onchain-audit';
import { newSubmissionId } from '@/lib/genlayer';

export const runtime = 'nodejs';
export const maxDuration = 300;

const CONTEXT = 'ConsensusAudit / GenLayer contract';

function validSignature(raw: string, header: string | null): boolean {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret || !header?.startsWith('sha256=')) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(raw).digest('hex'), 'utf8');
  const given = Buffer.from(header.slice('sha256='.length), 'utf8');
  return expected.length === given.length && timingSafeEqual(expected, given);
}

async function postStatus(
  repo: string,
  sha: string,
  state: 'pending' | 'success' | 'failure' | 'error',
  description: string
) {
  const token = process.env.GITHUB_BOT_TOKEN;
  if (!token) {
    console.warn('GITHUB_BOT_TOKEN not set; cannot post commit status.');
    return;
  }
  const res = await fetch(`https://api.github.com/repos/${repo}/statuses/${sha}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'ConsensusAudit'
    },
    body: JSON.stringify({
      state,
      description: description.slice(0, 140),
      context: CONTEXT,
      ...(process.env.NEXT_PUBLIC_APP_URL ? { target_url: process.env.NEXT_PUBLIC_APP_URL } : {})
    })
  });
  if (!res.ok) console.warn(`Could not post commit status (${res.status}).`);
}

async function auditPullRequest(repo: string, prNumber: number, headSha: string) {
  try {
    const client = getGenLayerClient();
    if (!client) {
      await postStatus(repo, headSha, 'error', 'Not audited: GenLayer relayer is not configured.');
      return;
    }

    const bundle = await ingestGithubUrl(`https://github.com/${repo}/pull/${prNumber}`);
    if (bundle.commitSha !== headSha) {
      // A newer push landed while we were working. That push will trigger its own run.
      console.warn(`Head moved (${headSha} -> ${bundle.commitSha}); skipping stale run.`);
      return;
    }

    const submissionId = newSubmissionId('pr');
    // wallet=null: the relayer submits as itself, so no signature-delegation is involved.
    const { verdict } = await relayAudit(client, { submissionId, wallet: null, bundle });

    if (verdict.commit_sha !== headSha) throw new Error('Verdict commit does not match the PR head.');

    const short = String(submissionId).slice(-12);
    if (verdict.status === 'APPROVED') {
      await postStatus(repo, headSha, 'success', `GenLayer contract verdict APPROVED (id …${short}).`);
    } else {
      await postStatus(
        repo, headSha, 'failure',
        `GenLayer contract verdict REJECTED: ${verdict.critical_count} critical, ${verdict.high_count} high (id …${short}).`
      );
    }
  } catch (e: any) {
    const msg = e instanceof IngestError ? e.message : `GenLayer consensus unavailable: ${e?.message || e}`;
    console.error('Webhook audit failed:', msg);
    // Fail closed and honest: the PR is NOT reported as audited.
    await postStatus(repo, headSha, 'error', `Not audited. ${msg}`);
  }
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (!validSignature(raw, req.headers.get('x-hub-signature-256'))) {
    return NextResponse.json({ error: 'Invalid or missing webhook signature.' }, { status: 401 });
  }

  const event = req.headers.get('x-github-event');
  if (event === 'ping') return NextResponse.json({ message: 'pong' });

  let payload: any;
  try { payload = JSON.parse(raw); } catch { return NextResponse.json({ error: 'Bad JSON.' }, { status: 400 }); }

  if (event !== 'pull_request' || !['opened', 'synchronize', 'reopened'].includes(payload.action)) {
    return NextResponse.json({ message: 'Ignored event.' });
  }

  const repo = String(payload.repository?.full_name ?? '');
  const sha = String(payload.pull_request?.head?.sha ?? '');
  const number = Number(payload.pull_request?.number);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^[0-9a-f]{40}$/.test(sha) || !Number.isInteger(number)) {
    return NextResponse.json({ error: 'Unexpected payload.' }, { status: 400 });
  }

  await postStatus(repo, sha, 'pending', 'Submitting to the GenLayer audit contract…');
  after(() => auditPullRequest(repo, number, sha));
  return NextResponse.json({ message: 'Accepted; audit running on GenLayer.' }, { status: 202 });
}
