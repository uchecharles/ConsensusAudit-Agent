"use client";

import React, { useState, useEffect } from "react";
import {
  ShieldAlert, ShieldCheck, Cpu, Terminal, Play,
  FileCode2, Network, GitPullRequest, Link2, Filter,
  Plus, Zap, Layers, Activity, Download, Database, AlertTriangle,
  Lock, Unlock, Send, AlertCircle, Search, Shield, UserCog, Coins
} from "lucide-react";
import { connectWallet, currentAccount, signText, walletWrite, onMetaMask } from "@/lib/wallet";
import { genToWei, weiToGen } from "@/lib/units";

const AVAILABLE_EXTENSIONS = ['.sol', '.ts', '.tsx', '.js', '.py', '.rs', '.go', '.html', '.json'];
const EXPLORER_TX = 'https://explorer-studio-dev.genlayer.com/transactions';
const CONTRACT_ADDRESS = '0x2Aa8038ea96051fb4748E538E7665Fe4EB39ef24';
const CONTRACT_ADDRESS_SHORT = `${CONTRACT_ADDRESS.slice(0, 6)}...${CONTRACT_ADDRESS.slice(-6)}`;

const formatTimestamp = (value: any): string => {
  if (value === undefined || value === null || value === "") return new Date().toLocaleString();
  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && asNumber > 0) {
    return new Date(asNumber > 1e12 ? asNumber : asNumber * 1000).toLocaleString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
};

// 🚀 Helper component to automatically detect and link GenLayer transaction hashes
function FormattedLog({ text }: { text: string }) {
  if (!text) return null;
  
  // Matches standard EVM transaction hashes: 0x followed by 64 hex characters
  const txRegex = /(0x[a-fA-F0-9]{64})/g;
  const parts = text.split(txRegex);

  return (
    <span>
      {parts.map((part, i) => 
        txRegex.test(part) ? (
          <a 
            key={i}
            // Safely combining your base URL with the hash
            href={`${EXPLORER_TX.replace(/\/+$/, '')}/${part}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-400 underline decoration-indigo-500/30 underline-offset-2 hover:text-indigo-300 transition-colors"
            title="View on GenLayer Studio Explorer"
          >
            {part.slice(0, 10)}...{part.slice(-6)}
          </a>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </span>
  );
}

export default function Home() {
  const [inputMode, setInputMode] = useState<"github" | "manual">("github");
  const [repoUrl, setRepoUrl] = useState("");

  const [selectedExtensions, setSelectedExtensions] = useState<string[]>(['.sol', '.ts', '.tsx', '.py']);
  const [customExtensions, setCustomExtensions] = useState<string[]>([]);
  const [customInput, setCustomInput] = useState("");

  const [contractCode, setContractCode] = useState(`// SPDX-License-Identifier: MIT\npragma solidity ^0.8.20;\n\ncontract VulnerableVault {\n    mapping(address => uint256) public balances;\n\n    function deposit() external payable {\n        balances[msg.sender] += msg.value;\n    }\n\n    // Vulnerability: Reentrancy\n    function withdraw() external {\n        uint256 balance = balances[msg.sender];\n        require(balance > 0, "No balance");\n\n        (bool success, ) = msg.sender.call{value: balance}("");\n        require(success, "Transfer failed");\n\n        balances[msg.sender] = 0;\n    }\n}`);

  const [wallet, setWallet] = useState<string | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);

  const [isAuditing, setIsAuditing] = useState(false);
  const [auditStep, setAuditStep] = useState<string>("Ready. Choose a target to audit.");
  const [validatorsActive, setValidatorsActive] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [executionTime, setExecutionTime] = useState<number | null>(null);

  const [escrow, setEscrow] = useState<any>(null);
  const [escrowLoading, setEscrowLoading] = useState(false);
  const [escrowError, setEscrowError] = useState<string | null>(null);
  const [beneficiaryAddress, setBeneficiaryAddress] = useState("");
  const [amountGen, setAmountGen] = useState("0.01");

  const [rebuttal, setRebuttal] = useState("");
  const [isAppealing, setIsAppealing] = useState(false);

  const [adminInfo, setAdminInfo] = useState<{
    owner: string; paused: boolean; relayer?: string; balanceGen?: string; totalSubmissions?: number
  } | null>(null);
  const [relayerInput, setRelayerInput] = useState("");
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminMessage, setAdminMessage] = useState<string | null>(null);
  const [newOwnerInput, setNewOwnerInput] = useState("");
  const [forceRefundId, setForceRefundId] = useState("");

  const [lookupId, setLookupId] = useState("");
  const [lookupResult, setLookupResult] = useState<{ type: string; data: any } | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const [logs, setLogs] = useState<string[]>([
    "[00:00:01] Equivalence engine initialized.",
    "[00:00:01] Validator relay connected.",
    "[00:00:02] Validator committee (nodes 1, 2, 3) online."
  ]);

  const addLog = (msg: string) => {
    setLogs(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev.slice(0, 5)]);
  };

  const refreshAdmin = () => {
    fetch('/api/admin')
      .then(r => r.json())
      .then(d => { if (!d.error) setAdminInfo(d); })
      .catch(() => {});
  };

  useEffect(() => { refreshAdmin(); }, []);

  useEffect(() => {
    currentAccount().then(a => { if (a) setWallet(a); });
    const onAccounts = (accts: string[]) => setWallet(accts?.[0] ?? null);
    let eth: any = null;
    onMetaMask().then(p => { eth = p; eth?.on?.('accountsChanged', onAccounts); }).catch(() => {});
    return () => eth?.removeListener?.('accountsChanged', onAccounts);
  }, []);

  const handleConnect = async () => {
    setWalletError(null);
    try {
      setWallet(await connectWallet());
    } catch (e: any) {
      setWalletError(e?.message || 'Could not connect the wallet.');
    }
  };

  const isOwner = Boolean(wallet && adminInfo?.owner && wallet.toLowerCase() === String(adminInfo.owner).toLowerCase());

  // Audit request. With a connected wallet the server first pins the content to a commit and
  // returns the exact text to sign; the signed request is what authorises the on-chain write.
  // Without a wallet the audit is analysed off chain only and is never shown as GenLayer consensus.
  const requestAudit = async (extra: Record<string, any>) => {
    const base = inputMode === "github" ? { url: repoUrl, allowedExtensions: selectedExtensions } : { code: contractCode };
    const payload = { ...base, ...extra };
    const post = async (path: string, body: any) => {
      const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return data;
    };
    if (!wallet) return post('/api/audit', payload);

    setAuditStep("Pinning the content to an exact commit and hashing it...");
    const prep = await post('/api/audit/prepare', { ...payload, wallet });
    addLog(`Bound to commit ${prep.binding.commitSha ? prep.binding.commitSha.slice(0, 7) : '(pasted code)'} · content ${prep.binding.contentHash.slice(0, 10)}...`);
    if (prep.binding.truncated) addLog("Note: part of the source exceeded the review budget and was truncated. This is recorded in the scope.");
    setAuditStep("Confirm the request in your wallet...");
    const signature = await signText(wallet, prep.message);
    setAuditStep("Broadcasting to the validator committee...");
    return post('/api/audit', {
      ...payload, wallet, signature,
      nonce: prep.fields.nonce, issuedAt: prep.fields.issuedAt, expiresAt: prep.fields.expiresAt
    });
  };

  const toggleExtension = (ext: string) => {
    setSelectedExtensions(prev => prev.includes(ext) ? prev.filter(e => e !== ext) : [...prev, ext]);
  };

  const handleAddCustomExtension = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && customInput.trim() !== '') {
      e.preventDefault();
      let ext = customInput.trim().toLowerCase();
      if (!ext.startsWith('.')) ext = `.${ext}`;

      if (!AVAILABLE_EXTENSIONS.includes(ext) && !customExtensions.includes(ext)) {
        setCustomExtensions([...customExtensions, ext]);
        setSelectedExtensions([...selectedExtensions, ext]);
      } else if (!selectedExtensions.includes(ext)) {
        setSelectedExtensions([...selectedExtensions, ext]);
      }
      setCustomInput("");
    }
  };

  const isSubmitDisabled = isAuditing || (inputMode === "github" ? !/^https:\/\/github\.com\//.test(repoUrl) : !contractCode.trim());

  const describeMode = (data: any) => {
    if (data.mode === "genlayer-consensus") return "Consensus finalized on chain.";
    if (data.mode === "heuristic-fallback") return "Static heuristics only. Not a consensus verdict.";
    return "Off-chain model analysis, server-attested. Not a GenLayer verdict.";
  };

  const runConsensusAudit = async () => {
    if (inputMode === "github" && selectedExtensions.length === 0) {
      setAuditStep("Select at least one file type before running the audit.");
      addLog("Audit halted: no file extensions selected.");
      return;
    }
    if (adminInfo?.paused) {
      setAuditStep("Contract is paused. New submissions are not accepted right now.");
      addLog("Audit halted: contract is paused.");
      return;
    }

    setIsAuditing(true);
    setResult(null);
    setEscrow(null);
    setEscrowError(null);
    setBeneficiaryAddress("");
    setRebuttal("");
    setValidatorsActive(true);
    const startTime = performance.now();

    if (inputMode === "github") {
      setAuditStep("Fetching repository tree and parsing scope...");
      addLog(`Fetching target: ${repoUrl}`);
    } else {
      setAuditStep("Ingesting source payload...");
      addLog(`Ingested raw payload (${contractCode.length} chars).`);
    }

    try {
      const data = await requestAudit({});

      setExecutionTime(Math.round(performance.now() - startTime));
      setResult(data);
      setAuditStep(describeMode(data));

      if (data.mode === "genlayer-consensus") {
        addLog(`On-chain verdict recorded. Tx ${String(data.txHash).substring(0, 16)}...`);
        refreshAdmin();
      } else if (data.fallbackReason) {
        addLog(`Fell back off chain: ${data.fallbackReason}`);
      } else {
        addLog(`Verdict attested. Hash 0x${String(data.verdictHash).substring(0, 12)}...`);
      }

    } catch (error: any) {
      console.error(error);
      setAuditStep(error.message || "The audit could not be completed.");
      addLog(`Error: ${error.message}`);
    } finally {
      setIsAuditing(false);
      setValidatorsActive(false);
    }
  };

  const submitAppeal = async () => {
    if (!result || !rebuttal.trim()) return;
    setIsAppealing(true);
    setAuditStep("Re-running consensus with your rebuttal...");
    addLog("Appeal submitted.");

    try {
      const data = await requestAudit({ rebuttal, submissionId: result.submissionId || null });

      setResult(data);
      setEscrow(null);
      setEscrowError(null);
      setBeneficiaryAddress("");
      setRebuttal("");
      setAuditStep(`Appeal resolved. New verdict: ${data.status}.`);
      addLog(
        data.mode === "genlayer-consensus"
          ? `On-chain appeal tx ${String(data.txHash).substring(0, 16)}...`
          : `Appeal verdict attested.`
      );

    } catch (error: any) {
      console.error(error);
      setAuditStep(error.message || "The appeal could not be completed.");
      addLog(`Appeal error: ${error.message}`);
    } finally {
      setIsAppealing(false);
    }
  };

  const readEscrow = async (submissionId: string, txHash: string) => {
    const res = await fetch(`/api/lookup?submissionId=${encodeURIComponent(submissionId)}&type=escrow`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    if (!data.found) throw new Error('The contract returned no escrow record.');
    const e = data.data;
    return {
      status: e.status, amount: e.amount, amountGen: weiToGen(e.amount ?? '0'),
      beneficiary: e.beneficiary, depositor: e.depositor, releasedBy: e.released_by,
      txHash, onchain: true
    };
  };

  // Escrow is signed by YOUR wallet. The contract checks gl.message.sender_address, so the
  // depositor, beneficiary and owner roles are real wallet identities, not a shared server key.
  const callEscrow = async (action: 'create' | 'release' | 'claim' | 'refund') => {
    if (!result) return;
    if (result.mode !== 'genlayer-consensus') {
      setEscrowError('Escrow needs an on-chain verdict. Connect your wallet and run the audit again.');
      return;
    }
    if (!wallet) {
      setEscrowError('Connect your wallet to use escrow.');
      return;
    }
    if (action === 'create') {
      if (!/^0x[a-fA-F0-9]{40}$/.test(beneficiaryAddress.trim())) {
        setEscrowError('Enter a valid 0x... beneficiary address before opening escrow.');
        return;
      }
      if (!amountGen.trim() || Number(amountGen) <= 0) {
        setEscrowError('Enter a positive GEN amount before opening escrow.');
        return;
      }
    }

    setEscrowLoading(true);
    setEscrowError(null);
    try {
      const fn = action === 'create' ? 'open_escrow' : `${action}_escrow`;
      const args = action === 'create' ? [result.submissionId, beneficiaryAddress.trim()] : [result.submissionId];
      setAuditStep('Confirm the transaction in your wallet...');
      const tx = await walletWrite(wallet, fn, args, action === 'create' ? genToWei(amountGen) : undefined);
      const rec = await readEscrow(result.submissionId, tx.hash);
      setEscrow(rec);
      addLog(
        action === 'create' ? `Escrow opened on chain (${rec.amountGen} GEN). Tx: ${tx.hash}`
        : action === 'release' ? `Escrow released by your wallet. Tx: ${tx.hash}`
        : action === 'claim' ? `Escrow claimed by your wallet (beneficiary). Tx: ${tx.hash}`
        : `Escrow refunded to the depositor. Tx: ${tx.hash}`
      );
      refreshAdmin();
    } catch (e: any) {
      setEscrowError(e?.message || String(e));
      addLog(`Escrow: ${e?.message || e}`);
    } finally {
      setEscrowLoading(false);
    }
  };

  // Administration is signed by the connected wallet and enforced by the contract's owner check.
  const callAdmin = async (action: 'pause' | 'unpause' | 'transfer_ownership' | 'force_refund' | 'set_relayer') => {
    if (!wallet) { setAdminMessage('Error: connect the owner wallet first.'); return; }
    setAdminLoading(true);
    setAdminMessage(null);
    try {
      const call =
        action === 'pause' ? { fn: 'set_paused', args: [true] } :
        action === 'unpause' ? { fn: 'set_paused', args: [false] } :
        action === 'transfer_ownership' ? { fn: 'transfer_ownership', args: [newOwnerInput.trim()] } :
        action === 'set_relayer' ? { fn: 'set_relayer', args: [relayerInput.trim()] } :
        { fn: 'admin_force_refund', args: [forceRefundId.trim()] };

      const tx = await walletWrite(wallet, call.fn, call.args);
      setAdminMessage(`${action} succeeded. Tx: ${tx.hash}`);
      addLog(`Admin: ${action} confirmed on chain. Tx: ${tx.hash}`);
      refreshAdmin();
    } catch (e: any) {
      setAdminMessage(`Error: ${e?.message || e}`);
      addLog(`Admin error: ${e?.message || e}`);
    } finally {
      setAdminLoading(false);
    }
  };

  const doLookup = async (type: 'verdict' | 'escrow') => {
    if (!lookupId.trim()) return;
    setLookupLoading(true);
    setLookupError(null);
    setLookupResult(null);
    try {
      const res = await fetch(`/api/lookup?submissionId=${encodeURIComponent(lookupId.trim())}&type=${type}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (!data.found) {
        setLookupError('No record found for that submission ID.');
        return;
      }
      setLookupResult({ type, data: data.data });
    } catch (e: any) {
      setLookupError(e.message);
    } finally {
      setLookupLoading(false);
    }
  };

  const downloadReport = () => {
    if (!result) return;

    const targetInfo = inputMode === 'github' ? `GitHub target: ${repoUrl}` : `Raw payload (${contractCode.length} bytes)`;
    const attestationLine = result.mode === 'genlayer-consensus'
      ? `**On-chain submission ID:** \`${result.submissionId}\` (contract: ${result.contractAddress})\n**Transaction:** [\`${result.txHash}\`](${EXPLORER_TX}/${result.txHash})`
      : `**Submission ID:** \`${result.submissionId}\`\n**Attestation (${result.signed ? 'HMAC-signed' : 'unsigned digest'}):** \`0x${result.verdictHash}\``;

    const bindingLine = result.contentHash ? `**Reviewed content:** SHA-256 \`${result.contentHash}\`\n**Commit:** ${result.commitSha ? `\`${result.commitSha}\`` : '(pasted code, no commit)'}\n**Scope hash:** \`${result.scopeHash}\`${result.reviewTruncated ? '\n**Note:** part of the source exceeded the review budget and was truncated (recorded in the scope).' : ''}\n${result.mode === 'genlayer-consensus' ? `**Hash recomputed by contract:** ${result.contentHashVerifiedOnChain ? 'yes' : 'no (runner lacks hashlib)'}\n` : ''}` : '';
    const reportContent = `# ConsensusAudit — security certificate\n\n**Generated:** ${formatTimestamp(result.timestamp)}\n**Target:** ${targetInfo}\n${attestationLine}\n${bindingLine}**Audit mode:** ${result.mode}${result.isAppeal ? `\n**Appeal of:** \`${result.previousVerdictHash}\`` : ''}\n\n## Verdict: ${result.status}\n\n### Metrics\n- Execution latency: ${executionTime ?? 0}ms\n\n### Vulnerability summary\n- Critical: ${result.critical_count}\n- High: ${result.high_count}\n\n## Findings\n\n${(result.findings || []).map((f: any) => `### ${f.type} [${f.severity}]\n${f.summary}\n`).join('\n')}\n\n---\n*ConsensusAudit v2.0*`;

    const blob = new Blob([reportContent], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ConsensusAudit_${String(result.submissionId || Date.now()).substring(0, 24)}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const allExtensions = [...AVAILABLE_EXTENSIONS, ...customExtensions];

  return (
    <div className="min-h-screen bg-[#07090E] text-slate-100 font-sans selection:bg-indigo-500 selection:text-white pb-16">

      <div className="absolute top-0 left-1/4 w-[600px] h-[250px] bg-indigo-600/10 blur-[140px] pointer-events-none rounded-full" />
      <div className="absolute top-20 right-1/4 w-[500px] h-[200px] bg-violet-600/10 blur-[140px] pointer-events-none rounded-full" />

      <header className="border-b border-slate-800/80 bg-[#0B0F19]/90 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-2.5 bg-gradient-to-br from-indigo-500/20 to-violet-500/20 text-indigo-400 rounded-xl border border-indigo-500/30 shadow-inner">
              <Network className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-xl font-bold tracking-tight text-white">ConsensusAudit</h1>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-mono bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 uppercase tracking-widest">
                  v2.0-PRO
                </span>
              </div>
              <p className="text-xs text-slate-400">GenLayer intelligent contract security and deployment gatekeeper</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {adminInfo?.paused && (
              <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs font-mono text-amber-400">
                <AlertTriangle className="w-3.5 h-3.5" /> Contract paused
              </div>
            )}
            <button
              onClick={handleConnect}
              title={walletError ?? "Connect the wallet that will sign audits, escrow and admin actions"}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl border text-xs font-mono transition ${
                wallet ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300" : "bg-indigo-600/20 border-indigo-500/40 text-indigo-200 hover:bg-indigo-600/30"
              }`}
            >
              {wallet ? `${wallet.slice(0, 6)}...${wallet.slice(-4)}${isOwner ? " · owner" : ""}` : "Connect wallet"}
            </button>
            <a
              href={`https://explorer-studio-dev.genlayer.com/address/${CONTRACT_ADDRESS}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-slate-900/90 border border-slate-800 text-xs font-mono text-slate-300 shadow-sm hover:border-indigo-500/50 transition"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              GenLayer live: {CONTRACT_ADDRESS_SHORT}
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 pt-8 space-y-6">

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-4 rounded-2xl bg-[#0B0F19]/70 border border-slate-800/80 backdrop-blur-md space-y-1 relative overflow-hidden">
            <div className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">Inference engine</div>
            <div className="text-sm font-bold text-slate-200 flex items-center gap-2">
              <Zap className="w-4 h-4 text-indigo-400" /> GenLayer validators
            </div>
          </div>
          <div className="p-4 rounded-2xl bg-[#0B0F19]/70 border border-slate-800/80 backdrop-blur-md space-y-1 relative overflow-hidden">
            <div className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">Consensus rule</div>
            <div className="text-sm font-bold text-slate-200 flex items-center gap-2">
              <Layers className="w-4 h-4 text-violet-400" /> gl.eq_principle
            </div>
          </div>
          <div className="p-4 rounded-2xl bg-[#0B0F19]/70 border border-slate-800/80 backdrop-blur-md space-y-1 relative overflow-hidden">
            <div className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">Total submissions</div>
            <div className="text-sm font-bold text-slate-200 flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-400" /> {adminInfo?.totalSubmissions ?? '—'}
            </div>
          </div>
          <div className="p-4 rounded-2xl bg-[#0B0F19]/70 border border-slate-800/80 backdrop-blur-md space-y-1 relative overflow-hidden">
            <div className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">Contract balance</div>
            <div className="text-sm font-mono font-bold text-indigo-300 flex items-center gap-2">
              <Coins className="w-4 h-4 text-indigo-400" /> {adminInfo?.balanceGen ?? '—'} GEN
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

          <div className="lg:col-span-6 space-y-6">
            <div className="p-6 rounded-2xl border border-slate-800 bg-[#0B0F19]/80 backdrop-blur-xl shadow-2xl space-y-6">

              <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
                <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-slate-300 font-bold">
                  <FileCode2 className="w-4 h-4 text-indigo-400" />
                  Target and scope
                </div>

                <div className="flex bg-slate-950 rounded-xl p-1 border border-slate-800">
                  <button
                    onClick={() => setInputMode("github")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${inputMode === "github" ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30" : "text-slate-400 hover:text-slate-200"}`}
                  >
                    <GitPullRequest className="w-3.5 h-3.5" /> Repository
                  </button>
                  <button
                    onClick={() => setInputMode("manual")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${inputMode === "manual" ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30" : "text-slate-400 hover:text-slate-200"}`}
                  >
                    <FileCode2 className="w-3.5 h-3.5" /> Raw code
                  </button>
                </div>
              </div>

              {inputMode === "github" ? (
                <div className="space-y-5">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-slate-400">GitHub repository or pull request URL</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                        <Link2 className="w-4 h-4 text-slate-500" />
                      </div>
                      <input
                        type="text"
                        value={repoUrl}
                        onChange={(e) => setRepoUrl(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 pl-10 pr-4 text-sm text-slate-200 focus:outline-none focus:border-indigo-500 transition shadow-inner"
                        placeholder="https://github.com/..."
                      />
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
                        <Filter className="w-3.5 h-3.5 text-indigo-400" />
                        <span>File types to audit</span>
                      </div>
                      <span className="text-[11px] font-mono text-indigo-400 font-medium">{selectedExtensions.length} active</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 p-3.5 rounded-xl bg-slate-950 border border-slate-800/80">
                      {allExtensions.map(ext => (
                        <button
                          key={ext}
                          onClick={() => toggleExtension(ext)}
                          className={`px-2.5 py-1 text-xs rounded-lg font-mono transition border ${
                            selectedExtensions.includes(ext)
                              ? "bg-indigo-600/20 text-indigo-300 border-indigo-500/50 shadow-sm"
                              : "bg-slate-900/60 text-slate-500 border-slate-800 hover:border-slate-700 hover:text-slate-400"
                          }`}
                        >
                          {ext}
                        </button>
                      ))}

                      <div className="relative flex items-center">
                        <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">
                          <Plus className="w-3 h-3 text-slate-500" />
                        </div>
                        <input
                          type="text"
                          value={customInput}
                          onChange={(e) => setCustomInput(e.target.value)}
                          onKeyDown={handleAddCustomExtension}
                          placeholder="add .ext"
                          className="w-20 bg-slate-900 border border-slate-800 rounded-lg py-1 pl-6 pr-2 text-xs text-slate-300 font-mono focus:outline-none focus:border-indigo-500 transition"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-400">Contract source</label>
                  <div className="relative rounded-xl border border-slate-800 bg-slate-950 overflow-hidden shadow-inner">
                    <textarea
                      value={contractCode}
                      onChange={(e) => setContractCode(e.target.value)}
                      rows={13}
                      spellCheck={false}
                      className="w-full bg-transparent p-4 font-mono text-xs text-slate-200 outline-none resize-none leading-relaxed"
                    />
                  </div>
                </div>
              )}

              <button
                onClick={runConsensusAudit}
                disabled={isSubmitDisabled}
                className={`w-full py-4 px-6 rounded-xl font-medium text-sm flex items-center justify-center gap-2.5 transition shadow-lg ${
                  isSubmitDisabled
                    ? "bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700"
                    : "bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white shadow-indigo-600/30 active:scale-[0.99]"
                }`}
              >
                {isAuditing ? (
                  <><Cpu className="w-4 h-4 animate-spin text-indigo-300" /> Running consensus...</>
                ) : (
                  <><Play className="w-4 h-4 fill-current" /> Run audit</>
                )}
              </button>
            </div>

            <div className="p-6 rounded-2xl border border-slate-800 bg-[#0B0F19]/80 backdrop-blur-xl shadow-2xl space-y-3">
              <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-slate-300 font-bold">
                <Search className="w-4 h-4 text-indigo-400" />
                Look up a submission
              </div>
              <input
                type="text"
                value={lookupId}
                onChange={(e) => setLookupId(e.target.value)}
                placeholder="submission_id, e.g. audit_1699999999999_ab12cd34"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2.5 px-3.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500 transition"
              />
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => doLookup('verdict')}
                  disabled={lookupLoading || !lookupId.trim()}
                  className="py-2 rounded-xl text-xs font-medium bg-slate-900 border border-slate-800 text-slate-300 hover:border-indigo-500/50 transition disabled:opacity-50"
                >
                  get_verdict
                </button>
                <button
                  onClick={() => doLookup('escrow')}
                  disabled={lookupLoading || !lookupId.trim()}
                  className="py-2 rounded-xl text-xs font-medium bg-slate-900 border border-slate-800 text-slate-300 hover:border-indigo-500/50 transition disabled:opacity-50"
                >
                  get_escrow
                </button>
              </div>
              {lookupError && <p className="text-[11px] text-rose-400">{lookupError}</p>}
              {lookupResult && (
                <pre className="text-[10px] text-slate-300 bg-slate-950 p-3 rounded-xl border border-slate-800 overflow-x-auto whitespace-pre-wrap break-words">
                  {JSON.stringify(lookupResult.data, null, 2)}
                </pre>
              )}
            </div>
          </div>

          <div className="lg:col-span-6 space-y-6">

            <div className="p-6 rounded-2xl border border-slate-800 bg-[#0B0F19]/80 backdrop-blur-xl shadow-2xl space-y-5">
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-slate-300 font-bold">
                  <Terminal className="w-4 h-4 text-indigo-400" />
                  Validator telemetry
                </div>
                <span className={`text-[11px] px-2.5 py-0.5 rounded-full font-mono font-medium ${validatorsActive ? "bg-amber-500/10 text-amber-400 border border-amber-500/30 animate-pulse" : "bg-slate-900 text-slate-400 border border-slate-800"}`}>
                  {validatorsActive ? "Consensus in progress" : "Nodes on standby"}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-3">
                {[1, 2, 3].map((node) => (
                  <div key={node} className={`p-3 rounded-xl border text-center transition ${validatorsActive ? "border-indigo-500/50 bg-indigo-950/20 text-indigo-300 animate-pulse" : result ? (result.status === "REJECTED" ? "border-rose-500/30 bg-rose-950/10 text-rose-300" : "border-emerald-500/30 bg-emerald-950/10 text-emerald-300") : "border-slate-800 bg-slate-950 text-slate-500"}`}>
                    <div className="text-[10px] font-mono tracking-wider opacity-75">NODE #{node}</div>
                    <div className="text-xs font-bold mt-1">
                      {validatorsActive ? "Simulating exploit" : result ? "Verified" : "Standby"}
                    </div>
                  </div>
                ))}
              </div>

              <div className="space-y-1.5">
                <div className="text-[11px] font-mono text-slate-400 flex items-center justify-between">
                  <span>Execution log</span>
                  <span className="text-indigo-400">{auditStep}</span>
                </div>
                <div className="font-mono text-[11px] text-slate-300 bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-1 max-h-28 overflow-y-auto shadow-inner">
                  {logs.map((log, index) => (
                    <div key={index} className="flex items-center gap-2 text-slate-400">
                      <span className="text-indigo-500">&gt;</span>
                      <span className="truncate">
                        <FormattedLog text={log} />
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {result && (
              <div className={`p-6 rounded-2xl border backdrop-blur-xl shadow-2xl transition-all space-y-5 ${result.status === "REJECTED" ? "border-rose-500/40 bg-gradient-to-b from-rose-950/25 to-[#0B0F19]" : "border-emerald-500/40 bg-gradient-to-b from-emerald-950/25 to-[#0B0F19]"}`}>

                {result.mode === "heuristic-fallback" && (
                  <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span><strong>Pattern matching only.</strong> No validator reached this verdict, so it is not a consensus result.</span>
                  </div>
                )}

                {result.mode === "llm-consensus" && (
                  <div className="flex items-start gap-2 p-3 rounded-xl bg-slate-500/10 border border-slate-500/20 text-slate-400 text-xs">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span><strong>Settled off chain.</strong> Multi-model consensus, attested by this server rather than recorded on chain.</span>
                  </div>
                )}

                {result.fallbackReason && (
                  <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 text-[11px] text-slate-400 font-mono break-words">
                    {result.fallbackReason}
                  </div>
                )}

                {result.codeTruncatedOnChain && (
                  <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      <strong>Partial analysis.</strong> The on-chain validator committee has a per-transaction
                      time budget, so it analyzed the first {result.codeCharsAnalyzed?.toLocaleString()} of{' '}
                      {result.codeCharsTotal?.toLocaleString()} characters submitted. Anything past that point
                      wasn't seen by this verdict.
                    </span>
                  </div>
                )}

                {result.isAppeal && (
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs">
                    <Send className="w-4 h-4" />
                    <span><strong>Appeal verdict.</strong> Re-run with your rebuttal in context.</span>
                  </div>
                )}

                <div className="flex items-start justify-between border-b border-slate-800/80 pb-4">
                  <div className="flex items-center gap-3">
                    {result.status === "REJECTED" ? (
                      <div className="p-2.5 rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/30">
                        <ShieldAlert className="w-5 h-5" />
                      </div>
                    ) : (
                      <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                        <ShieldCheck className="w-5 h-5" />
                      </div>
                    )}
                    <div>
                      <h2 className="font-bold text-base text-white">
                        {result.status === "REJECTED" ? "Deployment blocked" : "Deployment cleared"}
                      </h2>
                      <div className="flex flex-col gap-1.5 mt-1.5 text-[10px] font-mono text-slate-400">
                        <div className="flex items-center gap-1.5">
                          <Database className="w-3 h-3 text-indigo-400" />
                          <span>ID: {result.submissionId}</span>
                        </div>
                        {result.mode === 'genlayer-consensus' ? (
                          <div className="flex items-center gap-1.5">
                            <Link2 className="w-3 h-3 text-indigo-400" />
                            <span>Tx: <a href={`${EXPLORER_TX}/${result.txHash}`} target="_blank" rel="noopener noreferrer" className="hover:text-indigo-300 underline decoration-indigo-500/30 underline-offset-2">{String(result.txHash).substring(0, 16)}...</a></span>
                          </div>
                        ) : result.verdictHash ? (
                          <div className="flex items-center gap-1.5">
                            <Lock className="w-3 h-3 text-indigo-400" />
                            <span>{result.signed ? "Signed" : "Unsigned digest"}: 0x{String(result.verdictHash).substring(0, 16)}...</span>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <span className={`px-3 py-1 rounded-lg text-xs font-bold font-mono tracking-wide border ${result.status === "REJECTED" ? "bg-rose-500/20 text-rose-300 border-rose-500/30" : "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"}`}>
                      {result.status}
                    </span>
                    <button
                      onClick={downloadReport}
                      className="flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-indigo-300 transition group"
                    >
                      <Download className="w-3 h-3 group-hover:-translate-y-0.5 transition-transform" />
                      Export certificate
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="text-xs font-mono uppercase tracking-wider text-slate-400 flex items-center justify-between">
                    <span>Findings</span>
                    <span className="text-slate-300">{result.findings?.length || 0} total</span>
                  </div>
                  {(result.findings || []).map((finding: any, idx: number) => (
                    <div key={idx} className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-2 shadow-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-200 text-sm">{finding.type}</span>
                        <span className={`px-2 py-0.5 rounded font-mono font-medium border ${finding.severity === "Critical" || finding.severity === "High" ? "bg-rose-500/15 text-rose-400 border-rose-500/30" : finding.severity === "Medium" ? "bg-amber-500/15 text-amber-400 border-amber-500/30" : "bg-slate-800 text-slate-300 border-slate-700"}`}>
                          {finding.severity}
                        </span>
                      </div>
                      <p className="text-slate-400 leading-relaxed text-xs">{finding.summary}</p>
                    </div>
                  ))}
                </div>

                <div className="pt-4 border-t border-slate-800/80 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-slate-400">
                      {escrow?.status === 'RELEASED' ? <Unlock className="w-3.5 h-3.5 text-emerald-400" /> : <Lock className="w-3.5 h-3.5 text-indigo-400" />}
                      <span>Escrow settlement</span>
                    </div>
                    {escrow && (
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono border ${
                        escrow.status === 'RELEASED' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' :
                        escrow.status === 'BLOCKED' ? 'bg-rose-500/10 text-rose-400 border-rose-500/30' :
                        escrow.status === 'REFUNDED' || escrow.status === 'ADMIN_REFUNDED' ? 'bg-slate-500/10 text-slate-300 border-slate-600' :
                        'bg-amber-500/10 text-amber-400 border-amber-500/30'
                      }`}>
                        {escrow.status} · {escrow.amountGen ?? escrow.amount}{escrow.onchain ? ' GEN · on chain' : ''}
                      </span>
                    )}
                  </div>

                  {!escrow ? (
                    <div className="space-y-2">
                      {result.mode === 'genlayer-consensus' && (
                        <div className="grid grid-cols-3 gap-2">
                          <input
                            type="text"
                            value={beneficiaryAddress}
                            onChange={(e) => setBeneficiaryAddress(e.target.value)}
                            placeholder="Beneficiary 0x... address"
                            className="col-span-2 bg-slate-950 border border-slate-800 rounded-xl py-2 px-3 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500 transition"
                          />
                          <input
                            type="text"
                            value={amountGen}
                            onChange={(e) => setAmountGen(e.target.value)}
                            placeholder="GEN"
                            className="bg-slate-950 border border-slate-800 rounded-xl py-2 px-3 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500 transition"
                          />
                        </div>
                      )}
                      <button
                        onClick={() => callEscrow('create')}
                        disabled={escrowLoading}
                        className="w-full py-2.5 rounded-xl text-xs font-medium bg-slate-900 border border-slate-800 text-slate-300 hover:border-indigo-500/50 transition disabled:opacity-50"
                      >
                        {escrowLoading ? "Placing hold..." : result.mode === 'genlayer-consensus' ? `Place ${amountGen || '0'} GEN in escrow` : "Place funds in escrow"}
                      </button>
                    </div>
                  ) : escrow.status === 'HELD' ? (
                    <div className={`grid gap-2 ${result.mode === 'genlayer-consensus' ? 'grid-cols-3' : 'grid-cols-2'}`}>
                      <button
                        onClick={() => callEscrow('release')}
                        disabled={escrowLoading || result.status !== 'APPROVED'}
                        className={`py-2.5 rounded-xl text-xs font-medium transition ${
                          result.status === 'APPROVED'
                            ? "bg-emerald-600/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-600/30"
                            : "bg-slate-900 border border-slate-800 text-slate-600 cursor-not-allowed"
                        }`}
                      >
                        {result.status === 'APPROVED' ? "Release" : "Locked"}
                      </button>
                      {result.mode === 'genlayer-consensus' && (
                        <button
                          onClick={() => callEscrow('claim')}
                          disabled={escrowLoading || result.status !== 'APPROVED'}
                          className={`py-2.5 rounded-xl text-xs font-medium transition ${
                            result.status === 'APPROVED'
                              ? "bg-indigo-600/20 border border-indigo-500/40 text-indigo-300 hover:bg-indigo-600/30"
                              : "bg-slate-900 border border-slate-800 text-slate-600 cursor-not-allowed"
                          }`}
                        >
                          Claim
                        </button>
                      )}
                      <button
                        onClick={() => callEscrow('refund')}
                        disabled={escrowLoading || result.status === 'APPROVED'}
                        className={`py-2.5 rounded-xl text-xs font-medium transition ${
                          result.status !== 'APPROVED'
                            ? "bg-slate-900 border border-slate-700 text-slate-300 hover:border-slate-600"
                            : "bg-slate-900 border border-slate-800 text-slate-600 cursor-not-allowed"
                        }`}
                      >
                        Refund
                      </button>
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-500">
                      {escrow.status === 'RELEASED'
                        ? `Released ${formatTimestamp(escrow.releasedAt)}`
                        : escrow.status === 'REFUNDED' || escrow.status === 'ADMIN_REFUNDED'
                        ? `Refunded ${formatTimestamp(escrow.releasedAt)}`
                        : "Release blocked: the verdict was not approved."}
                    </p>
                  )}

                  {escrowError && (
                    <p className="text-[11px] text-rose-400 leading-relaxed">{escrowError}</p>
                  )}

                  <p className="text-[10px] text-slate-600 leading-relaxed">
                    {result.mode === 'genlayer-consensus'
                      ? "Escrow transactions are signed by your connected wallet, so the contract sees you as the real depositor, beneficiary or owner. The contract checks the caller and the verdict before moving anything. Opening escrow attaches real GEN via gl.message.value."
                      : "Escrow is only available for on-chain verdicts. Connect your wallet and run the audit again to get one; off-chain analysis cannot hold or move funds."}
                  </p>
                </div>

                {result.status === 'REJECTED' && (
                  <div className="pt-4 border-t border-slate-800/80 space-y-2.5">
                    <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-slate-400">
                      <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                      <span>Appeal this verdict</span>
                    </div>
                    <textarea
                      value={rebuttal}
                      onChange={(e) => setRebuttal(e.target.value)}
                      rows={3}
                      placeholder="Explain why the flagged findings are false positives, or where in the codebase they are already mitigated..."
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 outline-none focus:border-indigo-500 transition resize-none"
                    />
                    <button
                      onClick={submitAppeal}
                      disabled={isAppealing || !rebuttal.trim()}
                      className="w-full py-2.5 rounded-xl text-xs font-medium bg-indigo-600/20 border border-indigo-500/40 text-indigo-300 hover:bg-indigo-600/30 transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {isAppealing ? (
                        <><Cpu className="w-3.5 h-3.5 animate-spin" /> Re-running consensus...</>
                      ) : (
                        <><Send className="w-3.5 h-3.5" /> Submit appeal</>
                      )}
                    </button>
                    <p className="text-[10px] text-slate-600">Appeals are capped at two per submission.</p>
                  </div>
                )}
              </div>
            )}

            <div className="p-6 rounded-2xl border border-slate-800 bg-[#0B0F19]/80 backdrop-blur-xl shadow-2xl space-y-4">
              <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-slate-300 font-bold">
                <Shield className="w-4 h-4 text-indigo-400" />
                Contract administration
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-slate-400">
                <div className="flex items-center justify-between bg-slate-950 p-3 rounded-xl border border-slate-800">
                  <span className="flex items-center gap-1.5"><UserCog className="w-3.5 h-3.5" /> Owner</span>
                  <span className="text-slate-300 truncate max-w-[140px]">{adminInfo?.owner || "loading..."}</span>
                </div>
                <div className="flex items-center justify-between bg-slate-950 p-3 rounded-xl border border-slate-800">
                  <span className="flex items-center gap-1.5"><Coins className="w-3.5 h-3.5" /> Balance</span>
                  <span className="text-slate-300">{adminInfo?.balanceGen ?? '—'} GEN</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => callAdmin(adminInfo?.paused ? 'unpause' : 'pause')}
                  disabled={adminLoading}
                  className={`flex-1 py-2 rounded-xl text-xs font-medium transition ${
                    adminInfo?.paused
                      ? "bg-emerald-600/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-600/30"
                      : "bg-amber-600/20 border border-amber-500/40 text-amber-300 hover:bg-amber-600/30"
                  } disabled:opacity-50`}
                >
                  {adminInfo?.paused ? "Unpause contract" : "Pause contract"}
                </button>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] text-slate-500">Transfer ownership</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newOwnerInput}
                    onChange={(e) => setNewOwnerInput(e.target.value)}
                    placeholder="New owner 0x... address"
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-xl py-2 px-3 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500 transition"
                  />
                  <button
                    onClick={() => callAdmin('transfer_ownership')}
                    disabled={adminLoading || !newOwnerInput.trim()}
                    className="px-4 py-2 rounded-xl text-xs font-medium bg-slate-900 border border-slate-800 text-slate-300 hover:border-indigo-500/50 transition disabled:opacity-50"
                  >
                    Transfer
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] text-slate-500">Approved relayer (may submit audits for wallets that signed a request) · current: {adminInfo?.relayer || "none"}</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={relayerInput}
                    onChange={(e) => setRelayerInput(e.target.value)}
                    placeholder="Relayer 0x... address (empty clears)"
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-xl py-2 px-3 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500 transition"
                  />
                  <button
                    onClick={() => callAdmin('set_relayer')}
                    disabled={adminLoading || !isOwner}
                    className="px-4 py-2 rounded-xl text-xs font-medium bg-slate-900 border border-slate-800 text-slate-300 hover:border-indigo-500/50 transition disabled:opacity-50"
                  >
                    Set relayer
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] text-slate-500">Force-refund a stuck escrow (break-glass)</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={forceRefundId}
                    onChange={(e) => setForceRefundId(e.target.value)}
                    placeholder="submission_id"
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-xl py-2 px-3 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500 transition"
                  />
                  <button
                    onClick={() => callAdmin('force_refund')}
                    disabled={adminLoading || !forceRefundId.trim()}
                    className="px-4 py-2 rounded-xl text-xs font-medium bg-rose-600/20 border border-rose-500/40 text-rose-300 hover:bg-rose-600/30 transition disabled:opacity-50"
                  >
                    Force refund
                  </button>
                </div>
              </div>

              {adminMessage && (
                <p className={`text-[11px] leading-relaxed ${adminMessage.startsWith('Error') ? 'text-rose-400' : 'text-emerald-400'}`}>
                  <FormattedLog text={adminMessage} />
                </p>
              )}

              <p className="text-[10px] text-slate-600 leading-relaxed">
                These actions are signed by your connected wallet. The contract rejects them unless that wallet is the owner, and no server key can perform them.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
