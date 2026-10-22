// app/api/audit/prepare/route.ts
// Step 1 of a wallet-signed audit: the server pins the content to a commit, hashes it, and
// returns the exact text the wallet must sign. Nothing is written on chain here.
import { NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { resolveBundle, type AuditRequest } from '@/lib/audit-input';
import { IngestError } from '@/lib/github-pin';
import { buildAuthMessage, newAuthFields, submissionIdFor } from '@/lib/audit-auth';

export const maxDuration = 60;
export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
    const rl = await checkRateLimit(ip);
    if (!rl.allowed) return NextResponse.json({ error: `Rate limit exceeded. Try again in ${rl.retryAfterSeconds}s.` }, { status: 429 });

    const body = (await req.json()) as AuditRequest & { wallet?: string };
    const wallet = String(body.wallet ?? '');
    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) return NextResponse.json({ error: 'A connected wallet address is required.' }, { status: 400 });

    const action = body.rebuttal ? 'appeal' : 'audit';
    const { bundle, prior } = await resolveBundle(body, { pinToPrior: true });

    if (prior && String(prior.submitter).toLowerCase() !== wallet.toLowerCase()) {
      return NextResponse.json({ error: 'Only the wallet that submitted the original audit can appeal it.' }, { status: 403 });
    }

    const fields = newAuthFields(action, wallet);
    const rebuttal = body.rebuttal ? String(body.rebuttal) : null;
    const message = buildAuthMessage(fields, bundle, body.submissionId ?? null, rebuttal);

    return NextResponse.json({
      message,
      fields,
      submissionId: submissionIdFor(action, fields.nonce),
      binding: {
        repoUrl: bundle.repoUrl,
        commitSha: bundle.commitSha,
        contentHash: bundle.contentHash,
        scopeHash: bundle.scopeHash,
        truncated: bundle.truncated,
        files: bundle.manifest.files.map(f => ({ path: f.p, bytes: f.n, included: f.i, truncated: f.t === 1 }))
      }
    });
  } catch (e: any) {
    const status = e instanceof IngestError ? e.status : 500;
    return NextResponse.json({ error: e?.message || String(e) }, { status });
  }
}
