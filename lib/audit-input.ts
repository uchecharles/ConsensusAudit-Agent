// lib/audit-input.ts
// Turns a request body into the exact Bundle that will be reviewed.
import 'server-only';
import { type Bundle, manualBundle } from './binding';
import { IngestError, ingestGithubUrl, reproduceFromManifest } from './github-pin';
import { getReadClient, GENLAYER_CONTRACT_ADDRESS } from './genlayer';

export type AuditRequest = {
  url?: string;
  code?: string;
  allowedExtensions?: unknown;
  submissionId?: string; // prior submission id (appeals)
  rebuttal?: string;
};

export async function readOnchainVerdict(submissionId: string): Promise<any | null> {
  const raw = (await getReadClient().readContract({
    address: GENLAYER_CONTRACT_ADDRESS,
    functionName: 'get_verdict',
    args: [submissionId]
  })) as string;
  return raw ? JSON.parse(raw) : null;
}

/**
 * New audit: ingest fresh, pinned to the commit resolved right now.
 * Appeal (signed path): re-create exactly what the prior on-chain verdict reviewed.
 */
export async function resolveBundle(req: AuditRequest, opts: { pinToPrior: boolean }): Promise<{ bundle: Bundle; prior: any | null }> {
  const isAppeal = Boolean(req.rebuttal);
  if (isAppeal && !req.submissionId) {
    throw new IngestError('This appeal is missing the original submissionId, so the prior verdict cannot be located.');
  }

  if (isAppeal && opts.pinToPrior) {
    const prior = await readOnchainVerdict(String(req.submissionId));
    if (!prior) throw new IngestError('No on-chain verdict exists for that submissionId.', 404);
    if (prior.status !== 'REJECTED') throw new IngestError('Only a REJECTED verdict can be appealed.');
    if (!prior.content_hash || !prior.scope_manifest) {
      throw new IngestError('That verdict predates content binding and cannot be appealed. Submit a new audit.');
    }
    let bundle: Bundle;
    try {
      const manifest = JSON.parse(prior.scope_manifest);
      if (manifest.kind === 'manual') {
        if (!req.code || !String(req.code).trim()) throw new IngestError('Resend the originally audited code to appeal pasted code.');
        bundle = manualBundle(String(req.code));
        if (bundle.contentHash !== prior.content_hash || bundle.scopeManifest !== prior.scope_manifest) {
          throw new IngestError('The code does not match what was originally audited. Submit a new audit instead.', 409);
        }
      } else {
        bundle = await reproduceFromManifest(prior.scope_manifest, prior.content_hash);
      }
    } catch (e) {
      if (e instanceof IngestError) throw e;
      throw new IngestError('The prior verdict has an unreadable scope; submit a new audit.', 409);
    }
    return { bundle, prior };
  }

  if (req.url) return { bundle: await ingestGithubUrl(req.url, req.allowedExtensions), prior: null };
  if (req.code && String(req.code).trim()) return { bundle: manualBundle(String(req.code)), prior: null };
  throw new IngestError('No code could be processed.');
}
