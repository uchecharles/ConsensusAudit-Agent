// lib/genlayer.ts
import 'server-only';
import { createClient, createAccount } from 'genlayer-js';
import { studioDevnet } from 'genlayer-js/chains';

export {
  GENLAYER_CONTRACT_ADDRESS,
  GENLAYER_EXPLORER_TX,
  GENLAYER_EXPLORER_ADDRESS
} from './contract-public';

const CHAIN = studioDevnet;

export const NO_VALUE = 0n;

/**
 * The relayer client. Its key is used ONLY to (a) pay for and submit audits whose
 * request was signed by the user's wallet, and (b) post contract-backed GitHub
 * statuses. It must never be used for escrow or administration: those are
 * signed by the user's own wallet in the browser (see lib/wallet.ts).
 */
export function getGenLayerClient() {
  const raw = (process.env.GENLAYER_PRIVATE_KEY ?? '').trim().replace(/^["']|["']$/g, '');
  if (!raw) return null;
  const pk = /^[0-9a-fA-F]{64}$/.test(raw) ? `0x${raw}` : raw;
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    console.warn('GENLAYER_PRIVATE_KEY is set but is not a 32-byte hex key (0x + 64 hex characters).');
    return null;
  }
  const account = createAccount(pk as `0x${string}`);
  return createClient({ chain: CHAIN, account });
}

/** Read-only client (no account / no key needed). Use for every view call. */
export function getReadClient() {
  return createClient({ chain: CHAIN });
}

export async function ensureConsensus(_client: any) {
  return;
}

export { withFees, pickHigherFees, resolveFees } from './genlayer-fees';

export function newSubmissionId(prefix = 'audit') {
  const rand = crypto.randomUUID().split('-')[0];
  return `${prefix}_${Date.now()}_${rand}`;
}

export { genToWei, weiToGen } from './units';
