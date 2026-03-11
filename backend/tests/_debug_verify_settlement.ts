/**
 * Debug script: verify a settlement transaction via TONAPI.
 * Emulates all checks the confirm endpoint does:
 *   1. Fetch raw event by ID → show in_progress, actions, statuses
 *   2. Run verifyByEventId() → check result
 *   3. Run verifySettlementOnChain() (contract events scan) → check result
 *   4. Fetch raw transaction by hash → show aborted/compute/action phase
 *   5. Fetch trace (full message chain)
 *
 * Run:
 *   cd backend && bun run tests/_debug_verify_settlement.ts <EVENT_ID_OR_TX_HASH>
 *   cd backend && bun run tests/_debug_verify_settlement.ts --scan
 *
 * Override defaults with env vars:
 *   SENDER=0QDz... RECIPIENT=0QAx... DEBT=3000000 bun run tests/_debug_verify_settlement.ts <HASH>
 */
import {
  verifyByEventId,
  verifySettlementOnChain,
  tonapiBaseUrl,
  tonapiHeaders,
  parseTxHash,
  normalizeAddress,
  friendlyToRaw,
} from '../src/services/tonapi';
import type { Env } from '../src/env';

// --- Config (testnet, overridable via env) ---
// Friendly-format addresses (auto-converted to raw for verification)
const V4_WALLET = '0QDzC7zwNFirW5jXeu-EjXfJCA8w7KsZcd1SYlaHQaPHLXKL';
const W5_WALLET = '0QBMsbxhNZbk4oCEYt6R_hOlm8_7-D4vooTnQxd2ArXG5yOS';
const W5_WALLET_2 = '0QAx3Tq4s87tAVa0e4JlJNNNIM29NlTIY7hUcWdRSSFro8v7';
const CONTRACT = 'EQBWECX8nJ3lk-90IdgLHoINEYvpmACCGnrqT0rTYH0mjgRu';
const DEBT_USDT = parseInt(process.env.DEBT ?? '3000000', 10); // 3 tUSDT default

/** Convert address to raw format (0:hex) — handles both friendly and already-raw */
function toRaw(addr: string): string {
  if (addr.includes(':')) return addr; // already raw
  return friendlyToRaw(addr) ?? addr;
}

// TON Connect stores raw addresses in DB; TONAPI returns raw in events.
// Default: auto-detect sender/recipient from event (see main), fallback to these.
const SENDER = toRaw(process.env.SENDER ?? W5_WALLET);
const RECIPIENT = toRaw(process.env.RECIPIENT ?? W5_WALLET_2);

const env = {
  TON_NETWORK: 'testnet',
  TONAPI_KEY: '',
  SETTLEMENT_CONTRACT_ADDRESS: CONTRACT,
} as Env;

const baseUrl = tonapiBaseUrl(env);
const headers = tonapiHeaders(env);

// ─── Helpers ───

function header(title: string) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('═'.repeat(60));
}

function json(label: string, data: unknown) {
  console.log(`\n${label}:`);
  console.log(JSON.stringify(data, null, 2));
}

// ─── 1. Fetch raw event ───

async function fetchEvent(eventId: string) {
  header(`1. Raw event: ${eventId}`);
  const resp = await fetch(`${baseUrl}/v2/events/${eventId}`, {
    headers,
    signal: AbortSignal.timeout(10000),
  });

  if (!resp.ok) {
    console.log(`  HTTP ${resp.status} ${resp.statusText}`);
    return null;
  }

  const event = (await resp.json()) as any;

  console.log(`  in_progress: ${event.in_progress}`);
  console.log(`  is_scam:     ${event.is_scam}`);
  console.log(`  lt:          ${event.lt}`);
  console.log(
    `  timestamp:   ${event.timestamp} (${new Date(event.timestamp * 1000).toISOString()})`,
  );
  console.log(`  actions:     ${event.actions?.length ?? 0}`);

  if (event.actions) {
    for (const [i, action] of event.actions.entries()) {
      const t = action.type;
      const s = action.status;
      let detail = '';
      if (t === 'JettonTransfer' && action.JettonTransfer) {
        const jt = action.JettonTransfer;
        const from = jt.sender?.address ?? '?';
        const to = jt.recipient?.address ?? '?';
        const amt = jt.amount;
        detail = `  ${from.slice(0, 10)}… → ${to.slice(0, 10)}…  amount=${amt}`;
      }
      console.log(`  [${i}] type=${t}  status=${s}${detail}`);
    }
  }

  if (event.in_progress) {
    console.log(`\n  ** Event is in_progress — verification will be blocked **`);
  }

  return event;
}

// ─── 2. verifyByEventId ───

async function runVerifyByEventId(
  eventId: string,
  sender = SENDER,
  recipient = RECIPIENT,
  debt = DEBT_USDT,
) {
  header('2. verifyByEventId()');
  console.log(`  sender=${sender}`);
  console.log(`  recipient=${recipient}`);
  console.log(`  debtUsdt=${debt} (${debt / 1e6} USDT)`);
  const result = await verifyByEventId(env, eventId, sender, recipient, debt);
  json('Result', result);
  return result;
}

// ─── 3. verifySettlementOnChain (contract events scan) ───

async function runVerifyOnChain(sender = SENDER, recipient = RECIPIENT, debt = DEBT_USDT) {
  header('3. verifySettlementOnChain() — contract events scan');

  // Also fetch raw contract events so we can inspect in_progress flags
  const resp = await fetch(`${baseUrl}/v2/accounts/${CONTRACT}/events?limit=20`, {
    headers,
    signal: AbortSignal.timeout(10000),
  });

  if (resp.ok) {
    const data = (await resp.json()) as any;
    const events = data.events ?? [];
    console.log(`  Contract has ${events.length} recent events`);
    for (const ev of events.slice(0, 10)) {
      const actions = ev.actions ?? [];
      const types = actions.map((a: any) => `${a.type}(${a.status})`).join(', ');
      console.log(
        `  ${ev.event_id.slice(0, 16)}…  in_progress=${ev.in_progress}  actions=[${types}]`,
      );
    }
  }

  console.log(`\n  Verifying with sender=${sender}, recipient=${recipient}, debt=${debt}`);
  const settlement = { id: 999, amount: debt, toUser: 2 };
  const result = await verifySettlementOnChain(env, settlement, sender, recipient);
  json('Result', result);
  return result;
}

// ─── 4. Fetch raw transaction ───

async function fetchTransaction(txHash: string) {
  header(`4. Raw transaction: ${txHash}`);

  const resp = await fetch(`${baseUrl}/v2/blockchain/transactions/${txHash}`, {
    headers,
    signal: AbortSignal.timeout(10000),
  });

  if (!resp.ok) {
    console.log(`  HTTP ${resp.status} — trying events endpoint instead`);
    return;
  }

  const tx = (await resp.json()) as any;
  console.log(`  hash:           ${tx.hash}`);
  console.log(`  lt:             ${tx.lt}`);
  console.log(`  utime:          ${tx.utime} (${new Date(tx.utime * 1000).toISOString()})`);
  console.log(`  total_fees:     ${tx.total_fees}`);
  console.log(`  success:        ${tx.success}`);
  console.log(`  aborted:        ${tx.aborted}`);
  console.log(`  destroyed:      ${tx.destroyed}`);
  console.log(`  action_phase:`);
  if (tx.action_phase) {
    console.log(`    success:      ${tx.action_phase.success}`);
    console.log(`    result_code:  ${tx.action_phase.result_code}`);
    console.log(`    tot_actions:  ${tx.action_phase.tot_actions}`);
  }
  console.log(`  compute_phase:`);
  if (tx.compute_phase) {
    console.log(`    success:      ${tx.compute_phase.success}`);
    console.log(`    exit_code:    ${tx.compute_phase.exit_code}`);
    console.log(`    vm_steps:     ${tx.compute_phase.vm_steps}`);
    console.log(`    gas_used:     ${tx.compute_phase.gas_used}`);
  }

  return tx;
}

// ─── 5. Fetch trace (full message chain) ───

async function fetchTrace(eventId: string) {
  header(`5. Trace (message chain): ${eventId}`);

  const resp = await fetch(`${baseUrl}/v2/traces/${eventId}`, {
    headers,
    signal: AbortSignal.timeout(10000),
  });

  if (!resp.ok) {
    console.log(`  HTTP ${resp.status} ${resp.statusText}`);
    return;
  }

  const trace = (await resp.json()) as any;

  function printTrace(node: any, depth = 0) {
    const indent = '  '.repeat(depth + 1);
    const tx = node.transaction;
    if (tx) {
      const acct = tx.account?.address?.slice(0, 12) ?? '?';
      console.log(
        `${indent}${acct}…  success=${tx.success}  aborted=${tx.aborted}  fees=${tx.total_fees}  in_msg_decoded=${tx.in_msg?.decoded_op_name ?? '-'}`,
      );
    }
    if (node.children) {
      for (const child of node.children) {
        printTrace(child, depth + 1);
      }
    }
  }

  printTrace(trace);
}

// ─── Main ───

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.log('Usage: bun run tests/_debug_verify_settlement.ts <EVENT_ID_OR_TX_HASH>');
    console.log('       bun run tests/_debug_verify_settlement.ts --scan');
    console.log();
    console.log('Override with env vars:');
    console.log(
      '  SENDER=... RECIPIENT=... DEBT=3000000 bun run tests/_debug_verify_settlement.ts <HASH>',
    );
    console.log();
    console.log('Current config:');
    console.log(`  SENDER:    ${SENDER}`);
    console.log(`  RECIPIENT: ${RECIPIENT}`);
    console.log(`  CONTRACT:  ${CONTRACT}`);
    console.log(`  DEBT_USDT: ${DEBT_USDT} (${DEBT_USDT / 1e6} USDT)`);
    process.exit(1);
  }

  if (input === '--scan') {
    await runVerifyOnChain();
    return;
  }

  const eventId = parseTxHash(input);
  console.log(`Input: ${input}`);
  console.log(`Parsed event ID: ${eventId}`);

  const event = await fetchEvent(eventId);

  // Auto-detect sender/recipient from event if not overridden via env
  let sender = SENDER;
  let recipient = RECIPIENT;
  let debt = DEBT_USDT;
  if (event?.actions && !process.env.SENDER) {
    const jettons = event.actions.filter((a: any) => a.type === 'JettonTransfer' && a.status === 'ok');
    // Action[0] = sender → contract (incoming), Action[1] = contract → recipient (outgoing)
    if (jettons.length >= 2) {
      const incoming = jettons[0]?.JettonTransfer;
      const outgoing = jettons[1]?.JettonTransfer;
      if (incoming?.sender?.address) sender = incoming.sender.address;
      if (outgoing?.recipient?.address) recipient = outgoing.recipient.address;
      if (outgoing?.amount) debt = parseInt(outgoing.amount, 10);
      console.log(`\n  Auto-detected from event:`);
      console.log(`    sender:    ${sender}`);
      console.log(`    recipient: ${recipient}`);
      console.log(`    debt:      ${debt} (${debt / 1e6} USDT)`);
    }
  } else {
    console.log(`Config: sender=${sender}  recipient=${recipient}  debt=${debt}`);
  }

  await runVerifyByEventId(eventId, sender, recipient, debt);
  await runVerifyOnChain(sender, recipient, debt);
  await fetchTransaction(eventId);
  await fetchTrace(eventId);

  header('Done');
}

main().catch(console.error);
