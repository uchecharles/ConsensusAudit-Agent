// lib/genlayer-fees.ts
// Fee helpers shared by server routes and the browser wallet flow (no 'server-only').

export async function withFees(
  client: any,
  overrides?: { 
    leaderTimeunitsAllocation?: bigint; 
    validatorTimeunitsAllocation?: bigint; 
    rotations?: bigint[];
    totalMessageFees?: bigint;
    executionBudgetPerRound?: bigint;
  }
): Promise<{ distribution: any; feeValue: any } | undefined> {
  if (typeof client?.estimateTransactionFees !== 'function') return undefined;

  let attempt = 0;
  const maxAttempts = 7;

  while (attempt < maxAttempts) {
    try {
      const estimate = await client.estimateTransactionFees({
        leaderTimeunitsAllocation: overrides?.leaderTimeunitsAllocation ?? 600n,
        validatorTimeunitsAllocation: overrides?.validatorTimeunitsAllocation ?? 600n,
        // 🚀 FIX: Apply the cross-contract message budget overrides here!
        executionBudgetPerRound: overrides?.executionBudgetPerRound ?? 2_000_000_000n,
        totalMessageFees: overrides?.totalMessageFees ?? 0n,
        appealRounds: 1n,
        rotations: overrides?.rotations ?? [1n, 1n],
      });

      if (estimate && estimate.feeValue) {
        return {
          distribution: estimate.distribution,
          feeValue: estimate.feeValue,
        };
      }
    } catch (err: any) {
      console.warn(`Fee estimator attempt ${attempt + 1}/${maxAttempts} failed:`, err?.message);
    }

    attempt++;
    if (attempt < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }

  return undefined;
}

export function pickHigherFees(
  a?: { feeValue?: any; distribution?: any },
  b?: { feeValue?: any; distribution?: any }
) {
  if (!a) return b;
  if (!b) return a;
  const av = BigInt(a.feeValue ?? 0);
  const bv = BigInt(b.feeValue ?? 0);
  return av >= bv ? a : b;
}

export async function resolveFees(
  client: any,
  txPayload: { address: string; functionName: string; args: any[]; value?: bigint },
  manualBudget?: { 
    leaderTimeunitsAllocation: bigint; 
    validatorTimeunitsAllocation: bigint;
    totalMessageFees?: bigint;
    executionBudgetPerRound?: bigint;
  }
): Promise<{ distribution: any; feeValue: any } | undefined> {
  let simulated: any;
  try {
    simulated = await client.estimateTransactionFeesForWrite(txPayload);
  } catch (simErr: any) {
    console.warn(`Fee simulation failed for ${txPayload.functionName}:`, simErr?.message || simErr);
    simulated = undefined;
  }

  if (!manualBudget) return simulated;

  const manual = await withFees(client, manualBudget);
  return pickHigherFees(simulated, manual) as any;
}

