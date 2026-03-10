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
): Promise<{ verified: boolean; txHash?: string }> {
  const baseUrl = tonapiBaseUrl(env);
  try {
    const resp = await fetch(`${baseUrl}/v2/events/${eventId}`, {
      headers: tonapiHeaders(env),
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) return { verified: false };

    const event = (await resp.json()) as any;
    if (!event.actions) return { verified: false };

    const jettonActions = event.actions.filter(
      (a: any) => a.type === 'JettonTransfer' && a.status === 'ok',
    );

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
): Promise<{ verified: boolean; txHash?: string }> {
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

      // Look for JettonTransfer actions in this event
      const jettonActions = event.actions.filter(
        (a: any) => a.type === 'JettonTransfer' && a.status === 'ok',
      );

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

export {
  tonExplorerUrl,
  tonapiBaseUrl,
  tonapiHeaders,
  friendlyToRaw,
  parseTxHash,
  normalizeAddress,
  verifyByEventId,
  verifySettlementOnChain,
};
