// app/api/admin/route.ts
// READ-ONLY. Administration (pause, ownership, force-refund, relayer) is signed by the
// owner's own wallet in the browser and enforced by the contract's sender check. There is
// deliberately no POST here: an HTTP endpoint holding a key must never be able to do it.
import { NextResponse } from 'next/server';
import { getReadClient, GENLAYER_CONTRACT_ADDRESS, weiToGen } from '@/lib/genlayer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const client = getReadClient();
    const read = (functionName: string) =>
      client.readContract({ address: GENLAYER_CONTRACT_ADDRESS, functionName: functionName as any, args: [] });

    const [owner, paused, balanceWei, totalSubmissions, version, relayer] = await Promise.all([
      read('get_owner') as Promise<string>,
      read('is_paused') as Promise<boolean>,
      read('get_contract_balance') as Promise<string>,
      read('get_total_submissions') as Promise<number>,
      read('get_version') as Promise<string>,
      read('get_relayer').catch(() => '') as Promise<string>
    ]);

    return NextResponse.json({
      owner,
      paused,
      relayer,
      balanceWei: String(balanceWei),
      balanceGen: weiToGen(balanceWei ?? '0'),
      totalSubmissions: Number(totalSubmissions ?? 0),
      version
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 });
  }
}

export function POST() {
  return NextResponse.json(
    { error: 'Administration is signed by the contract owner’s wallet, not by this server.' },
    { status: 405 }
  );
}
