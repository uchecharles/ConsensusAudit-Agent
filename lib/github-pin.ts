// lib/github-pin.ts
// GitHub ingestion pinned to an immutable commit SHA. Nothing here reads a branch
// name after the first resolution step, so the bytes that get hashed are the bytes
// that were reviewed, and an appeal can re-fetch exactly the same content.
import 'server-only';
import {
  type Bundle, type Manifest, type ManifestFile, PER_FILE_CHARS, MAX_PAYLOAD_CHARS,
  gitBlobSha, makeBundle, sha256Hex
} from './binding';

const API = 'https://api.github.com';
const NAME = '[A-Za-z0-9_.-]+';
const SHA40 = /^[0-9a-f]{40}$/;

export class IngestError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function headers(accept = 'application/vnd.github+json'): HeadersInit {
  const h: Record<string, string> = {
    Accept: accept,
    'User-Agent': 'ConsensusAudit',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

async function gh(path: string, accept?: string): Promise<Response> {
  return fetch(`${API}${path}`, { headers: headers(accept), signal: AbortSignal.timeout(15000) });
}

async function ghJson<T = any>(path: string, what: string): Promise<T> {
  const res = await gh(path);
  if (!res.ok) throw new IngestError(`GitHub could not provide ${what} (status ${res.status}). It may be private, missing, or rate limited.`);
  return res.json() as Promise<T>;
}

const encPath = (p: string) => p.split('/').map(encodeURIComponent).join('/');

async function fetchFileAtCommit(repo: string, commit: string, path: string): Promise<{ text: string; blob: string }> {
  const res = await gh(`/repos/${repo}/contents/${encPath(path)}?ref=${commit}`, 'application/vnd.github.raw+json');
  if (!res.ok) throw new IngestError(`Could not fetch ${path} at commit ${commit.slice(0, 7)} (status ${res.status}).`);
  const buf = Buffer.from(await res.arrayBuffer());
  return { text: buf.toString('utf8'), blob: gitBlobSha(buf) };
}

async function resolveCommit(repo: string, ref: string): Promise<string> {
  const data = await ghJson<{ sha: string }>(`/repos/${repo}/commits/${encodeURI(ref)}`, `commit "${ref}"`);
  if (!SHA40.test(data.sha)) throw new IngestError('GitHub returned an unexpected commit id.');
  return data.sha;
}

/** "main/src/a.sol" is ambiguous when branch names contain slashes: try the shortest refs first. */
async function splitRefAndPath(repo: string, rest: string[], needPath: boolean): Promise<{ commit: string; path: string }> {
  const maxRef = needPath ? Math.min(rest.length - 1, 4) : Math.min(rest.length, 4);
  for (let i = 1; i <= maxRef; i++) {
    const ref = rest.slice(0, i).join('/');
    try {
      const commit = await resolveCommit(repo, ref);
      return { commit, path: rest.slice(i).join('/') };
    } catch { /* try a longer ref */ }
  }
  throw new IngestError('Could not resolve that branch, tag or commit on GitHub.');
}

export function normalizeExtensions(allowed?: unknown): string[] {
  const defaults = ['.sol', '.ts', '.html', '.js', '.py'];
  const list = Array.isArray(allowed) && allowed.length > 0
    ? allowed.map((e: any) => String(e).trim().toLowerCase()).filter(Boolean).map(e => (e.startsWith('.') ? e : `.${e}`))
    : defaults;
  return Array.from(new Set(list)).sort();
}

const scoreFile = (path: string) => {
  let score = 0;
  const p = path.toLowerCase();
  if (p.endsWith('.sol')) score += 10;
  if (p.includes('contract')) score += 8;
  if (p.includes('core')) score += 5;
  if (p.includes('interface')) score += 5;
  if (p.includes('main')) score += 3;
  if (p.includes('test') || p.includes('mock')) score -= 10;
  return score;
};

const TRUNC_MARK = '\n...[TRUNCATED]';

function entry(p: string, blob: string, full: string, included: string, truncated: boolean): ManifestFile {
  return { p: p.slice(0, 200), b: blob, s: sha256Hex(full), n: full.length, i: included.length, t: truncated ? 1 : 0 };
}

function capPayload(payload: string): { payload: string; cut: 0 | 1 } {
  if (payload.length <= MAX_PAYLOAD_CHARS) return { payload, cut: 0 };
  return { payload: payload.slice(0, MAX_PAYLOAD_CHARS - TRUNC_MARK.length) + TRUNC_MARK, cut: 1 };
}

// ---------------------------------------------------------------------------
// Builders. Each takes already-resolved commits so they are reproducible.
// ---------------------------------------------------------------------------
async function buildRepo(repo: string, commit: string, ext: string[], paths: string[] | null, treeTruncated: 0 | 1): Promise<Bundle> {
  let chosen = paths;
  if (!chosen) {
    const tree = await ghJson<any>(`/repos/${repo}/git/trees/${commit}?recursive=1`, 'the repository tree');
    treeTruncated = tree.truncated ? 1 : 0;
    chosen = (tree.tree as any[])
      .filter(it =>
        it.type === 'blob' &&
        (it.size ?? 0) <= 1_000_000 &&
        ext.some(e => it.path.toLowerCase().endsWith(e)) &&
        !it.path.includes('node_modules/') && !it.path.includes('dist/') && !it.path.includes('.next/'))
      .map(it => it.path as string)
      .sort((a, b) => scoreFile(b) - scoreFile(a) || (a < b ? -1 : 1))
      .slice(0, 3);
    if (chosen.length === 0) throw new IngestError('No files matched the selected extensions.');
  }

  let payload = `--- REPOSITORY ARCHITECTURE FOR ${repo} @ ${commit} ---\n\n`;
  const files: ManifestFile[] = [];
  for (const path of chosen) {
    const { text, blob } = await fetchFileAtCommit(repo, commit, path);
    const truncated = text.length > PER_FILE_CHARS;
    const included = truncated ? text.slice(0, PER_FILE_CHARS) + TRUNC_MARK : text;
    payload += `\n// FILE: ${path}\n${included}`;
    files.push(entry(path, blob, text, included, truncated));
  }
  const capped = capPayload(payload);
  const manifest: Manifest = { v: 1, kind: 'repo', repo, commit, ext, files, tt: treeTruncated, cut: capped.cut };
  return makeBundle(manifest, capped.payload, `https://github.com/${repo}`);
}

async function buildBlob(repo: string, commit: string, path: string): Promise<Bundle> {
  const { text, blob } = await fetchFileAtCommit(repo, commit, path);
  const capped = capPayload(text);
  const manifest: Manifest = {
    v: 1, kind: 'blob', repo, commit, ext: [],
    files: [entry(path, blob, text, capped.payload, capped.cut === 1)], tt: 0, cut: capped.cut
  };
  return makeBundle(manifest, capped.payload, `https://github.com/${repo}/blob/${commit}/${path}`.slice(0, 300));
}

async function buildPr(repo: string, number: number, base: string, head: string): Promise<Bundle> {
  const res = await gh(`/repos/${repo}/compare/${base}...${head}`, 'application/vnd.github.v3.diff');
  if (!res.ok) throw new IngestError(`GitHub could not produce the PR diff (status ${res.status}).`);
  const diff = await res.text();
  if (!diff.trim()) throw new IngestError('That pull request has an empty diff.');
  const capped = capPayload(diff);
  const manifest: Manifest = {
    v: 1, kind: 'pr', repo, commit: head, base, pr: number, ext: [],
    files: [entry(`PR#${number}.diff`, '', diff, capped.payload, capped.cut === 1)], tt: 0, cut: capped.cut
  };
  return makeBundle(manifest, capped.payload, `https://github.com/${repo}/pull/${number}`);
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------
export async function ingestGithubUrl(url: string, allowedExtensions?: unknown): Promise<Bundle> {
  const clean = String(url).trim();
  if (!/^https:\/\/github\.com\//.test(clean)) throw new IngestError('Only https://github.com/ URLs are supported.');

  const pr = clean.match(new RegExp(`^https://github\\.com/(${NAME})/(${NAME})/pull/(\\d+)`));
  if (pr) {
    const repo = `${pr[1]}/${pr[2]}`;
    const meta = await ghJson<any>(`/repos/${repo}/pulls/${pr[3]}`, 'the pull request');
    return buildPr(repo, Number(pr[3]), meta.base.sha, meta.head.sha);
  }

  const blob = clean.match(new RegExp(`^https://github\\.com/(${NAME})/(${NAME})/blob/([^?#]+)`));
  if (blob) {
    const repo = `${blob[1]}/${blob[2]}`;
    const { commit, path } = await splitRefAndPath(repo, blob[3].split('/').map(decodeURIComponent), true);
    if (!path) throw new IngestError('That blob URL has no file path.');
    return buildBlob(repo, commit, path);
  }

  const m = clean.match(new RegExp(`^https://github\\.com/(${NAME})/(${NAME}?)(?:\\.git)?(?:/tree/([^?#]+))?/?(?:[?#].*)?$`));
  if (!m) throw new IngestError('Invalid GitHub repository URL.');
  const repo = `${m[1]}/${m[2]}`;
  let commit: string;
  if (m[3]) {
    commit = (await splitRefAndPath(repo, m[3].replace(/\/$/, '').split('/').map(decodeURIComponent), false)).commit;
  } else {
    const meta = await ghJson<any>(`/repos/${repo}`, 'the repository');
    commit = await resolveCommit(repo, meta.default_branch);
  }
  return buildRepo(repo, commit, normalizeExtensions(allowedExtensions), null, 0);
}

/**
 * Re-fetch EXACTLY what a prior verdict reviewed, from its recorded manifest.
 * Throws unless the rebuilt scope manifest and content hash match the originals.
 */
export async function reproduceFromManifest(scopeManifest: string, expectedContentHash: string): Promise<Bundle> {
  let m: Manifest;
  try { m = JSON.parse(scopeManifest); } catch { throw new IngestError('The recorded scope manifest is unreadable.', 409); }
  if (m.kind === 'manual') throw new IngestError('Pasted code cannot be re-fetched; resend the original code.', 400);
  if (!SHA40.test(m.commit)) throw new IngestError('The recorded commit is not a valid SHA.', 409);

  let b: Bundle;
  if (m.kind === 'repo') b = await buildRepo(m.repo, m.commit, m.ext, m.files.map(f => f.p), m.tt);
  else if (m.kind === 'blob') b = await buildBlob(m.repo, m.commit, m.files[0].p);
  else if (m.kind === 'pr' && m.base && m.pr) b = await buildPr(m.repo, m.pr, m.base, m.commit);
  else throw new IngestError('Unsupported recorded scope.', 409);

  if (b.scopeManifest !== scopeManifest || b.contentHash !== expectedContentHash) {
    throw new IngestError('The pinned content could not be reproduced exactly; refusing to appeal against different bytes.', 409);
  }
  return b;
}
