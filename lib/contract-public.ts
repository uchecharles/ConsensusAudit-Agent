// lib/contract-public.ts
// Plain constants only — no 'server-only' — so this is safe to import from
// both client components (page.tsx) and server routes/lib. This is the one
// place the contract address lives; nothing else is hardcoded in it.
//
// After deploying contracts/audit_registry.py (v9) to GenLayer Studio Dev,
// replace the address below (or set NEXT_PUBLIC_GENLAYER_CONTRACT_ADDRESS).
export const GENLAYER_CONTRACT_ADDRESS = (
  process.env.NEXT_PUBLIC_GENLAYER_CONTRACT_ADDRESS || '0x2Aa8038ea96051fb4748E538E7665Fe4EB39ef24'
) as `0x${string}`;
export const GENLAYER_CHAIN_ID = 61997; // GenLayer Studio Dev
export const GENLAYER_EXPLORER_TX = 'https://explorer-studio-dev.genlayer.com/transactions';
export const GENLAYER_EXPLORER_ADDRESS = 'https://explorer-studio-dev.genlayer.com/address';
