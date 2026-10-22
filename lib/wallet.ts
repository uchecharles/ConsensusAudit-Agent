// lib/wallet.ts
// Browser-side wallet flow. Every escrow and administration transaction is signed and sent
// by the USER's own wallet (window.ethereum), so the contract's gl.message.sender_address is
// the real depositor / beneficiary / owner. No server key is involved.
import { createClient } from 'genlayer-js';
import { studioDevnet } from 'genlayer-js/chains';
import { GENLAYER_CONTRACT_ADDRESS } from './contract-public';
import { resolveFees } from './genlayer-fees';

declare global {
  interface Window { ethereum?: any }
}

const chainIdHex = `0x${studioDevnet.id.toString(16)}`;

// Several wallets can inject window.ethereum and fight over it (Phantom does this). Prefer
// MetaMask: look for it through EIP-6963 announcements, then window.ethereum.providers.
let chosen: any = null;

async function pickProvider(): Promise<any> {
  if (chosen) return chosen;
  if (typeof window === 'undefined') throw new Error('No browser wallet found.');

  const announced: { info: { rdns?: string; name?: string }; provider: any }[] = [];
  const onAnnounce = (e: any) => { if (e?.detail?.provider) announced.push(e.detail); };
  window.addEventListener('eip6963:announceProvider', onAnnounce as any);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  await new Promise(r => setTimeout(r, 200));
  window.removeEventListener('eip6963:announceProvider', onAnnounce as any);

  const mm6963 = announced.find(a => a.info?.rdns === 'io.metamask')?.provider;
  const eth = window.ethereum;
  const legacy = Array.isArray(eth?.providers)
    ? eth.providers.find((p: any) => p.isMetaMask && !p.isPhantom)
    : (eth?.isMetaMask && !eth?.isPhantom ? eth : null);

  chosen = mm6963 || legacy || null;
  if (!chosen) {
    throw new Error('MetaMask was not found. Install MetaMask (or disable other wallet extensions such as Phantom) and reload.');
  }
  return chosen;
}

export async function ensureChain(): Promise<void> {
  const eth = await pickProvider();
  const current = await eth.request({ method: 'eth_chainId' });
  if (String(current).toLowerCase() === chainIdHex) return;
  const params = {
    chainId: chainIdHex,
    chainName: studioDevnet.name,
    rpcUrls: studioDevnet.rpcUrls.default.http,
    nativeCurrency: studioDevnet.nativeCurrency,
    blockExplorerUrls: studioDevnet.blockExplorers ? [studioDevnet.blockExplorers.default.url] : undefined
  };
  try {
    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainIdHex }] });
  } catch {
    await eth.request({ method: 'wallet_addEthereumChain', params: [params] });
    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainIdHex }] });
  }
}

export async function connectWallet(): Promise<string> {
  const accounts: string[] = await (await pickProvider()).request({ method: 'eth_requestAccounts' });
  if (!accounts?.[0]) throw new Error('The wallet did not return an account.');
  await ensureChain();
  return accounts[0];
}

export async function currentAccount(): Promise<string | null> {
  try {
    const accounts: string[] = await (await pickProvider()).request({ method: 'eth_accounts' });
    return accounts?.[0] ?? null;
  } catch {
    return null;
  }
}

const utf8Hex = (s: string) =>
  '0x' + Array.from(new TextEncoder().encode(s)).map(b => b.toString(16).padStart(2, '0')).join('');

/** EIP-191 personal_sign. The wallet shows the user the full text being signed. */
export async function signText(address: string, message: string): Promise<string> {
  return (await pickProvider()).request({ method: 'personal_sign', params: [utf8Hex(message), address] });
}

export type WalletTx = { hash: string };

/** Sign and send one contract write from the connected wallet, then wait for finalization. */
export async function walletWrite(
  address: string,
  functionName: string,
  args: any[],
  valueWei?: bigint
): Promise<WalletTx> {
  await ensureChain();
  const client: any = createClient({ chain: studioDevnet, account: address as `0x${string}`, provider: await pickProvider() });

  const payload: any = {
    address: GENLAYER_CONTRACT_ADDRESS,
    // No `account` here: the client already carries the wallet account as an object with .address.
    functionName,
    args,
    ...(valueWei && valueWei > 0n ? { value: valueWei } : {})
  };
  // Fees are estimated by simulating exactly this call; a call the contract would reject fails here.
  const fees = await resolveFees(client, payload);

  const hash: string = await client.writeContract({ ...payload, ...(fees ? { fees } : {}) });
  const receipt: any = await client.waitForTransactionReceipt({
    hash,
    waitUntil: 'finalized',
    interval: 3000,
    retries: 60
  });
  const exec = String(receipt?.txExecutionResultName ?? '');
  if (receipt?.status === 'reverted' || (exec && exec !== 'FINISHED_WITH_RETURN')) {
    throw new Error(`The contract rejected this transaction (${exec || 'reverted'}).`);
  }
  return { hash };
}

/** The MetaMask provider (for event listeners). */
export const onMetaMask = pickProvider;
