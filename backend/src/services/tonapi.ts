import {
  beginCell,
  Address,
  type Cell,
  internal,
  external,
  storeMessage,
  storeMessageRelaxed,
} from '@ton/core';
import type { Env } from '../env';

function tonExplorerUrl(env: Env, txHash: string): string {
  const base =
    env.TON_NETWORK === 'mainnet' ? 'https://tonviewer.com' : 'https://testnet.tonviewer.com';
  return `${base}/transaction/${txHash}`;
}

// --- TON address helpers ---

/** Convert a user-friendly TON address (base64/base64url) to raw format (wc:hex) */
function friendlyToRaw(friendly: string): string | null {
  try {
    let b64 = friendly.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) b64 += '=';
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    if (bytes.length !== 36) return null; // 1 flag + 1 wc + 32 hash + 2 crc
    const workchain = bytes[1] === 0xff ? -1 : bytes[1];
    const hash = Array.from(bytes.slice(2, 34))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return `${workchain}:${hash}`;
  } catch {
    return null;
  }
}

/**
 * Parse a tx hash from user input — accepts:
 * - Raw hex hash
 * - Tonviewer URL: https://tonviewer.com/transaction/{hash}
 * - Tonscan URL: https://tonscan.org/tx/{hash}
 * - Tonkeeper redirect URL with encoded tonviewer link
 */
function parseTxHash(input: string): string {
  const trimmed = input.trim();

  // Try to extract from URL patterns
  const tonviewerMatch = trimmed.match(/tonviewer\.com\/transaction\/([a-fA-F0-9]{64})/);
  if (tonviewerMatch) return tonviewerMatch[1];

  const tonscanMatch = trimmed.match(/tonscan\.org\/tx\/([a-fA-F0-9]{64})/);
  if (tonscanMatch) return tonscanMatch[1];

  // URL-encoded tonviewer link (e.g. from Tonkeeper redirect)
  try {
    const decoded = decodeURIComponent(trimmed);
    const decodedMatch = decoded.match(/tonviewer\.com\/transaction\/([a-fA-F0-9]{64})/);
    if (decodedMatch) return decodedMatch[1];
  } catch {
    // not a URL-encoded string
  }

  // Raw hex hash
  if (/^[a-fA-F0-9]{64}$/.test(trimmed)) return trimmed;

  return trimmed;
}

/** Normalize a TON address for comparison (strip 0: prefix, lowercase) */
function normalizeAddress(addr: string): string {
  return addr.replace(/^0:/, '').toLowerCase();
}

// --- TONAPI helpers ---

function tonapiBaseUrl(env: Env): string {
  return env.TON_NETWORK === 'mainnet' ? 'https://tonapi.io' : 'https://testnet.tonapi.io';
}

function tonapiHeaders(env: Env): Record<string, string> {
  const headers: Record<string, string> = {};
  if (env.TONAPI_KEY) {
    headers['Authorization'] = `Bearer ${env.TONAPI_KEY}`;
  }
  return headers;
}

/**
 * Verify a settlement by looking up a specific TONAPI event.
 * Used when the user provides a transaction hash/link.
 */
async function verifyByEventId(
  env: Env,
  eventId: string,
  debtorWallet: string | null,
  creditorWallet: string,
  debtUsdt: number,
): Promise<{ verified: boolean; txHash?: string; failed?: boolean }> {
  const baseUrl = tonapiBaseUrl(env);
  try {
    const resp = await fetch(`${baseUrl}/v2/events/${eventId}`, {
      headers: tonapiHeaders(env),
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) return { verified: false };

    const event = (await resp.json()) as any;
    if (!event.actions) return { verified: false };

    // Event still being processed — actions may change (transfers could bounce/fail).
    // Common with uninit wallet first tx (ContractDeploy keeps event in_progress).
    // Trace endpoint also returns speculative data for in_progress events — can't trust it.
    if (event.in_progress) return { verified: false };

    const allJettonActions = event.actions.filter((a: any) => a.type === 'JettonTransfer');
    const jettonActions = allJettonActions.filter((a: any) => a.status === 'ok');

    // Detect failed transactions
    if (jettonActions.length === 0 && allJettonActions.length > 0) {
      return { verified: false, failed: true };
    }

    // Validate debtor if wallet known
    if (debtorWallet) {
      const debtorNorm = normalizeAddress(debtorWallet);
      const hasValidSender = jettonActions.some((a: any) => {
        const transfer = a.JettonTransfer;
        if (!transfer) return false;
        return normalizeAddress(transfer.sender?.address ?? '') === debtorNorm;
      });
      if (!hasValidSender) return { verified: false };
    }

    // Find outgoing transfer to creditor with matching amount
    const creditorNorm = normalizeAddress(creditorWallet);
    const matchingTransfer = jettonActions.find((a: any) => {
      const transfer = a.JettonTransfer;
      if (!transfer) return false;
      const recipientNorm = normalizeAddress(transfer.recipient?.address ?? '');
      if (recipientNorm !== creditorNorm) return false;
      const transferAmount = parseInt(transfer.amount ?? '0', 10);
      const tolerance = Math.max(1, Math.floor(debtUsdt * 0.02));
      return Math.abs(transferAmount - debtUsdt) <= tolerance;
    });

    if (matchingTransfer) {
      return { verified: true, txHash: event.event_id ?? eventId };
    }
  } catch {
    // TONAPI error
  }
  return { verified: false };
}

/**
 * Verify a settlement on-chain by checking the contract's recent events.
 * Validates the full trace: sender (debtor) → contract → recipient (creditor),
 * with matching amount. This prevents spoofing by unrelated transfers.
 */
async function verifySettlementOnChain(
  env: Env,
  settlement: { id: number; amount: number; toUser: number },
  debtorWallet: string | null,
  creditorWallet: string,
  usdtAmount?: number, // micro-USDT (if already converted)
): Promise<{ verified: boolean; txHash?: string; failed?: boolean }> {
  const contractAddress = env.SETTLEMENT_CONTRACT_ADDRESS;
  if (!contractAddress) return { verified: false };

  const baseUrl = tonapiBaseUrl(env);
  try {
    const resp = await fetch(`${baseUrl}/v2/accounts/${contractAddress}/events?limit=20`, {
      headers: tonapiHeaders(env),
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) return { verified: false };

    const data = (await resp.json()) as any;
    const events = data.events ?? [];

    const debtUsdt = usdtAmount ?? settlement.amount;

    for (const event of events) {
      if (!event.actions) continue;

      // Event still being processed — skip (uninit wallet ContractDeploy, speculative data)
      if (event.in_progress) continue;

      // Check if this event involves the debtor (to detect failed txns)
      const allJettonActions = event.actions.filter((a: any) => a.type === 'JettonTransfer');

      // Look for successful JettonTransfer actions
      const jettonActions = allJettonActions.filter((a: any) => a.status === 'ok');

      // Detect failed/bounced transactions from the debtor
      // If we see a failed JettonTransfer from the debtor to the contract, the tx failed
      if (debtorWallet && jettonActions.length === 0 && allJettonActions.length > 0) {
        const debtorNorm = normalizeAddress(debtorWallet);
        const hasFailed = allJettonActions.some((a: any) => {
          const transfer = a.JettonTransfer;
          if (!transfer) return false;
          const senderAddr = normalizeAddress(transfer.sender?.address ?? '');
          return senderAddr === debtorNorm && a.status !== 'ok';
        });
        if (hasFailed) {
          console.log('[settlement:verify] detected failed/bounced tx', {
            eventId: event.event_id,
            settlementId: settlement.id,
          });
          return { verified: false, txHash: event.event_id, failed: true };
        }
      }

      // We need to find TWO matching transfers in the same event:
      // 1. Incoming: debtor → contract (amount = debt + commission)
      // 2. Outgoing: contract → creditor (amount ≈ debt)
      // Finding the outgoing transfer to creditor with correct amount is sufficient
      // when combined with sender validation on the incoming transfer.

      // Find incoming transfer from debtor to contract
      let hasValidIncoming = false;
      if (debtorWallet) {
        const debtorNorm = normalizeAddress(debtorWallet);
        hasValidIncoming = jettonActions.some((a: any) => {
          const transfer = a.JettonTransfer;
          if (!transfer) return false;
          const senderAddr = normalizeAddress(transfer.sender?.address ?? '');
          // Sender must be the debtor (or debtor's jetton wallet — TONAPI resolves to owner)
          return senderAddr === debtorNorm;
        });
      } else {
        // No debtor wallet on record — can't validate sender, skip sender check
        // This is less secure but allows verification when debtor wallet wasn't stored
        hasValidIncoming = true;
      }

      if (!hasValidIncoming) continue;

      // Find outgoing transfer to creditor with matching amount
      const creditorNorm = normalizeAddress(creditorWallet);
      const matchingTransfer = jettonActions.find((a: any) => {
        const transfer = a.JettonTransfer;
        if (!transfer) return false;

        // Recipient must be the creditor
        const recipientNorm = normalizeAddress(transfer.recipient?.address ?? '');
        if (recipientNorm !== creditorNorm) return false;

        // Amount: creditor receives the debt minus commission rounding
        const transferAmount = parseInt(transfer.amount ?? '0', 10);
        // Allow 2% tolerance for commission calculation differences
        const tolerance = Math.max(1, Math.floor(debtUsdt * 0.02));
        return Math.abs(transferAmount - debtUsdt) <= tolerance;
      });

      if (matchingTransfer) {
        return { verified: true, txHash: event.event_id };
      }
    }
  } catch {
    // TONAPI error — can't verify yet
  }

  return { verified: false };
}

// --- Gas estimation via TONAPI emulate ---

// Standard V4R2 subwallet_id for basechain
const V4R2_SUBWALLET_ID = 698983191;

type WalletVersion = 'v4' | 'v5' | null;

/** Detect wallet version from TONAPI account interfaces array */
function detectWalletVersion(interfaces: string[]): WalletVersion {
  if (interfaces.some((i) => i.includes('wallet_v5'))) return 'v5';
  if (interfaces.some((i) => i.includes('wallet_v4'))) return 'v4';
  return null;
}

/** Parse a numeric value from TONAPI get_method stack entry */
function parseStackNum(entry: any): number | null {
  const val = entry?.num ?? entry?.value;
  if (typeof val !== 'string') return null;
  return parseInt(val, val.startsWith('0x') ? 16 : 10);
}

/** Fetch wallet seqno via TONAPI get method */
async function fetchSeqno(
  baseUrl: string,
  walletAddress: string,
  env: Env,
): Promise<number | null> {
  try {
    const resp = await fetch(`${baseUrl}/v2/blockchain/accounts/${walletAddress}/methods/seqno`, {
      headers: tonapiHeaders(env),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as any;
    if (!data.success || !data.stack?.[0]) return null;
    return parseStackNum(data.stack[0]);
  } catch {
    return null;
  }
}

/** Fetch W5 wallet_id (subwallet_id) — needed for V5R1 message construction */
async function fetchWalletId(
  baseUrl: string,
  walletAddress: string,
  env: Env,
): Promise<number | null> {
  try {
    const resp = await fetch(
      `${baseUrl}/v2/blockchain/accounts/${walletAddress}/methods/get_subwallet_id`,
      { headers: tonapiHeaders(env), signal: AbortSignal.timeout(10000) },
    );
    if (!resp.ok) return null;
    const data = (await resp.json()) as any;
    if (!data.success || !data.stack?.[0]) return null;
    return parseStackNum(data.stack[0]);
  } catch {
    return null;
  }
}

/** Build V4R2 external message body (zero signature — use with ignore_signature_check) */
function buildV4R2Body(seqno: number, internalMsgCell: Cell): Cell {
  return beginCell()
    .storeUint(0n, 512) // zero signature (512 bits)
    .storeUint(V4R2_SUBWALLET_ID, 32)
    .storeUint(Math.floor(Date.now() / 1000) + 120, 32)
    .storeUint(seqno, 32)
    .storeUint(0, 8) // op: simple send
    .storeUint(3, 8) // send_mode: PAY_GAS_SEPARATELY | IGNORE_ERRORS
    .storeRef(internalMsgCell)
    .endCell();
}

/**
 * Build V5R1 (W5) external message body (zero signature).
 *
 * W5 format (from tonkeeper/w5 contract source):
 *   prefix:uint32 (0x7369676E = "sign")
 *   wallet_id:uint32
 *   valid_until:uint32
 *   seqno:uint32
 *   Maybe ^c5_actions    (standard TON OutList — send_msg actions)
 *   has_extended:int1    (extended actions: add/remove extension, etc.)
 *   signature:bits512    (at the END — contract uses get_last_bits)
 *
 * C5 OutList for single send_msg:
 *   ^(prev_actions_empty) + action_send_msg(0x0ec3c86d) + mode:uint8 + ^Message
 */
function buildV5R1Body(seqno: number, internalMsgCell: Cell, walletId: number): Cell {
  // Build C5 OutList: linked list of actions (single send_msg)
  const c5Actions = beginCell()
    .storeRef(beginCell().endCell()) // prev: empty OutList
    .storeUint(0x0ec3c86d, 32) // action_send_msg tag
    .storeUint(3, 8) // send_mode: PAY_GAS_SEPARATELY | IGNORE_ERRORS
    .storeRef(internalMsgCell) // ^Message
    .endCell();

  return (
    beginCell()
      .storeUint(0x7369676e, 32) // signed_external prefix
      .storeUint(walletId >>> 0, 32) // wallet_id as uint32
      .storeUint(Math.floor(Date.now() / 1000) + 120, 32) // valid_until
      .storeUint(seqno, 32)
      // Maybe ^c5_actions (present = true)
      .storeBit(true)
      .storeRef(c5Actions)
      // No extended actions
      .storeBit(false)
      .storeUint(0n, 512) // signature at the END (512 zero bits)
      .endCell()
  );
}

/** Recursively sum total_fees from a TONAPI trace */
function sumTraceFees(trace: any): number {
  let total = 0;
  if (trace?.transaction?.total_fees != null) {
    total += Number(trace.transaction.total_fees);
  }
  if (Array.isArray(trace?.children)) {
    for (const child of trace.children) {
      total += sumTraceFees(child);
    }
  }
  return total;
}

/**
 * Estimate settlement gas by emulating the full transaction trace via TONAPI.
 *
 * Builds a wallet → jetton wallet → contract → recipients message chain,
 * emulates it with ignore_signature_check=true, and sums total_fees from the trace.
 *
 * Returns total fees in nanoTON, or null if emulation fails (caller uses empirical fallback).
 */
async function estimateSettlementGas(params: {
  env: Env;
  senderAddress: string;
  senderJettonWallet: string;
  contractAddress: string;
  recipientAddress: string;
  totalAmount: number; // micro-USDT (debt + commission)
  forwardTonAmount: number; // nanoTON for contract execution
  walletInterfaces: string[];
}): Promise<number | null> {
  const {
    env,
    senderAddress,
    senderJettonWallet,
    contractAddress,
    recipientAddress,
    totalAmount,
    forwardTonAmount,
    walletInterfaces,
  } = params;

  const walletVersion = detectWalletVersion(walletInterfaces);
  if (!walletVersion) return null; // unsupported wallet — fall back to empirical

  const baseUrl = tonapiBaseUrl(env);

  try {
    // 1. Fetch seqno (and walletId for V5 wallets) in parallel
    const seqnoP = fetchSeqno(baseUrl, senderAddress, env);
    const walletIdP = walletVersion === 'v5' ? fetchWalletId(baseUrl, senderAddress, env) : null;
    const [seqno, walletId] = await Promise.all([seqnoP, walletIdP]);
    if (seqno === null) return null;
    if (walletVersion === 'v5' && walletId === null) return null;

    // 2. Build jetton transfer body (mirrors frontend's buildSettlementBody)
    const jettonBody = beginCell()
      .storeUint(0xf8a7ea5, 32) // op: jetton_transfer
      .storeUint(0, 64) // query_id
      .storeCoins(BigInt(totalAmount))
      .storeAddress(Address.parse(contractAddress))
      .storeAddress(Address.parse(senderAddress)) // response_destination
      .storeBit(false) // no custom_payload
      .storeCoins(BigInt(forwardTonAmount))
      .storeUint(0, 32) // forward_payload op = 0 (settlement)
      .storeAddress(Address.parse(recipientAddress))
      .endCell();

    // 3. Build internal message (wallet → sender's jetton wallet)
    // Value: generous amount so emulation succeeds (excess handling is negligible cost)
    const internalMsg = internal({
      to: Address.parse(senderJettonWallet),
      value: BigInt(forwardTonAmount) + 150_000_000n, // forward_ton + overhead
      bounce: true,
      body: jettonBody,
    });

    const internalMsgCell = beginCell().store(storeMessageRelaxed(internalMsg)).endCell();

    // 4. Build wallet-version-specific external message body
    let walletBody: Cell;
    if (walletVersion === 'v5') {
      walletBody = buildV5R1Body(seqno, internalMsgCell, walletId!);
    } else {
      walletBody = buildV4R2Body(seqno, internalMsgCell);
    }

    // 5. Wrap in external message to actual sender address
    const extMsg = external({
      to: Address.parse(senderAddress),
      body: walletBody,
    });

    const boc = beginCell().store(storeMessage(extMsg)).endCell().toBoc().toString('base64');

    // 6. Emulate full trace via TONAPI
    const resp = await fetch(`${baseUrl}/v2/traces/emulate?ignore_signature_check=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...tonapiHeaders(env) },
      body: JSON.stringify({ boc }),
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) return null;

    const trace = (await resp.json()) as any;
    const totalFees = sumTraceFees(trace);
    return totalFees > 0 ? totalFees : null;
  } catch {
    return null;
  }
}

export {
  tonExplorerUrl,
  tonapiBaseUrl,
  tonapiHeaders,
  friendlyToRaw,
  parseTxHash,
  normalizeAddress,
  verifyByEventId,
  verifySettlementOnChain,
  estimateSettlementGas,
  detectWalletVersion,
};
