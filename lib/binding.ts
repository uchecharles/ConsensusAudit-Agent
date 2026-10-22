// lib/binding.ts
// Everything an audit is bound to: the exact content, the commit it came from,
// and the scope (which files / which extensions) that was reviewed. The same
// hashes are recomputed by the contract, so they are not just server claims.
import { createHash } from 'crypto';

export const MAX_PAYLOAD_CHARS = 60000; // must match MAX_CODE_CHARS in the contract
export const MAX_MANIFEST_CHARS = 4000; // must match MAX_SCOPE_CHARS in the contract
export const PER_FILE_CHARS = 5000;
export const MAX_REBUTTAL_CHARS_ONCHAIN = 4000; // must match MAX_REBUTTAL_CHARS in the contract

export function sha256Hex(text: string | Buffer): string {
  return createHash('sha256').update(text).digest('hex');
}

/** git blob object id, so a file entry can be checked against the GitHub tree. */
export function gitBlobSha(buf: Buffer): string {
  return createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
}

export type ManifestFile = {
  p: string; // path (or PR diff label)
  b: string; // git blob sha ("" for diffs / pasted code)
  s: string; // sha256 of the FULL file text as fetched
  n: number; // full length in chars
  i: number; // chars actually included in the reviewed payload
  t: 0 | 1; // 1 if the file was truncated to fit the review budget
};

export type Manifest = {
  v: 1;
  kind: 'repo' | 'blob' | 'pr' | 'manual';
  repo: string; // "owner/name" or "manual"
  commit: string; // 40-hex head commit ("" for pasted code)
  base?: string; // PR base commit
  pr?: number;
  ext: string[]; // extension scope (repo kind)
  files: ManifestFile[];
  tt: 0 | 1; // 1 if the GitHub tree listing itself was truncated
  cut: 0 | 1; // 1 if the final payload was cut to MAX_PAYLOAD_CHARS
};

export type Bundle = {
  payload: string;
  repoUrl: string;
  commitSha: string;
  contentHash: string;
  scopeManifest: string; // canonical JSON string, stored verbatim on chain
  scopeHash: string;
  manifest: Manifest;
  truncated: boolean;
};

export function makeBundle(manifest: Manifest, payload: string, repoUrl: string): Bundle {
  const scopeManifest = JSON.stringify(manifest); // fixed key order: built the same way every time
  if (scopeManifest.length > MAX_MANIFEST_CHARS) {
    throw new Error('The review scope is too large to record on chain. Narrow the extensions or pick a single file.');
  }
  if (payload.length > MAX_PAYLOAD_CHARS) throw new Error('Internal error: payload exceeds the contract limit.');
  return {
    payload,
    repoUrl,
    commitSha: manifest.commit,
    contentHash: sha256Hex(payload),
    scopeManifest,
    scopeHash: sha256Hex(scopeManifest),
    manifest,
    truncated: manifest.cut === 1 || manifest.files.some(f => f.t === 1) || manifest.tt === 1
  };
}

export function manualBundle(code: string): Bundle {
  const payload = code.length > MAX_PAYLOAD_CHARS ? code.slice(0, MAX_PAYLOAD_CHARS) : code;
  const manifest: Manifest = {
    v: 1,
    kind: 'manual',
    repo: 'manual',
    commit: '',
    ext: [],
    files: [{ p: 'pasted-code', b: '', s: sha256Hex(code), n: code.length, i: payload.length, t: code.length > payload.length ? 1 : 0 }],
    tt: 0,
    cut: code.length > payload.length ? 1 : 0
  };
  return makeBundle(manifest, payload, 'manual:paste');
}
