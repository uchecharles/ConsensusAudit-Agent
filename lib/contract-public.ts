// lib/contract-public.ts
// Plain constants only — no 'server-only' — so this is safe to import from
// both client components (page.tsx) and server routes/lib. This is the one
// place the contract address lives; nothing else is hardcoded in it.
export const GENLAYER_CONTRACT_ADDRESS = '0x4E50b22a93F1359eb663170fC334810487f7eEC7';
export const GENLAYER_EXPLORER_TX = 'https://explorer-studio-dev.genlayer.com/transactions';
export const GENLAYER_EXPLORER_ADDRESS = 'https://explorer-studio-dev.genlayer.com/address';
