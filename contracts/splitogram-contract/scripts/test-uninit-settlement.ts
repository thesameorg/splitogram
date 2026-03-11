/**
 * Test: Send a Jetton settlement from an UNINIT wallet on testnet.
 *
 * Level 1 — mirrors the exact UI flow:
 *   - Same buildSettlementBody logic (frontend/src/utils/ton.ts)
 *   - Same V4R2 external message structure (backend/src/services/tonapi.ts)
 *   - But: signs with real private key (not TON Connect) and includes StateInit
 *
 * Usage:
 *   cd contracts/splitogram-contract
 *   npx tsx scripts/test-uninit-settlement.ts
 *
 * Prerequisites:
 *   - An uninit V4R2 wallet with TON balance (for gas) and tUSDT balance
 *   - Set MNEMONIC env var or edit the constant below
 */

import { mnemonicToPrivateKey } from '@ton/crypto';
import {
  beginCell,
  Address,
  internal,
  external,
  storeMessage,
  storeMessageRelaxed,
  contractAddress,
  StateInit,
  storeStateInit,
  Cell,
} from '@ton/core';
import { WalletContractV4 } from '@ton/ton';

// ============================================================
// CONFIG — edit these or pass via env
// ============================================================

// Mnemonic for the UNINIT test wallet (24 words, space-separated)
// You can also set MNEMONIC env var
const MNEMONIC =
  process.env.MNEMONIC ||
  'your 24 word mnemonic here';

// Splitogram testnet contract
const CONTRACT_ADDRESS = 'EQBWECX8nJ3lk-90IdgLHoINEYvpmACCGnrqT0rTYH0mjgRu';

// Recipient (wallet_b from testnet_addresses.json)
const RECIPIENT_ADDRESS = '0QBMsbxhNZbk4oCEYt6R_hOlm8_7-D4vooTnQxd2ArXG5yOS';

// tUSDT Jetton Master on testnet
const TUSDT_MASTER = 'kQBDzVlfzubS8ONL25kQNrjoVMF-NwyECbJOfKndeyseWAV7';

// Settlement amount: 1 tUSDT = 1_000_000 micro-units (6 decimals)
const SETTLEMENT_AMOUNT = 1_000_000;

// Commission: 1% clamped [0.1, 1.0] USDT → min 0.1 USDT = 100_000
const COMMISSION = 100_000;
const TOTAL_AMOUNT = SETTLEMENT_AMOUNT + COMMISSION; // 1_100_000

// Gas: 0.3 TON forward + some overhead
const FORWARD_TON = 300_000_000n; // 0.3 TON (nanoTON)
const GAS_ATTACH = 500_000_000n; // 0.5 TON total attached to internal msg

// TONAPI testnet
const TONAPI_BASE = 'https://testnet.tonapi.io';

// ============================================================
// HELPERS — copied from the codebase to keep it 1:1
// ============================================================

/**
 * Build Jetton transfer body — EXACT copy of frontend/src/utils/ton.ts buildSettlementBody
 */
function buildJettonTransferBody(params: {
  totalAmount: number;
  contractAddress: string;
  senderAddress: string;
  forwardTonAmount: bigint;
  recipientAddress: string;
}): Cell {
  return beginCell()
    .storeUint(0xf8a7ea5, 32) // op: jetton_transfer
    .storeUint(0, 64) // query_id
    .storeCoins(BigInt(params.totalAmount)) // jetton amount = debt + commission
    .storeAddress(Address.parse(params.contractAddress)) // destination: settlement contract
    .storeAddress(Address.parse(params.senderAddress)) // response_destination: excess TON back
    .storeBit(false) // no custom_payload
    .storeCoins(params.forwardTonAmount) // forward_ton_amount (gas for contract)
    // inline forward_payload (no Either bit, no ref — validated on testnet)
    .storeUint(0, 32) // op = 0 (settlement)
    .storeAddress(Address.parse(params.recipientAddress)) // who receives remainder
    .endCell();
}

/**
 * Build V4R2 signed external message body — mirrors backend/src/services/tonapi.ts buildV4R2Body
 * but with REAL signature instead of zero
 */
function buildV4R2SignedBody(
  seqno: number,
  internalMsgCell: Cell,
  secretKey: Buffer,
): Cell {
  const { sign } = require('@ton/crypto');

  const V4R2_SUBWALLET_ID = 698983191;

  // Build the signing payload (everything except the signature)
  const payload = beginCell()
    .storeUint(V4R2_SUBWALLET_ID, 32)
    .storeUint(Math.floor(Date.now() / 1000) + 120, 32) // valid_until
    .storeUint(seqno, 32)
    .storeUint(0, 8) // op: simple send
    .storeUint(3, 8) // send_mode: PAY_GAS_SEPARATELY | IGNORE_ERRORS
    .storeRef(internalMsgCell)
    .endCell();

  const signature = sign(payload.hash(), secretKey);

  return beginCell()
    .storeBuffer(signature) // 64 bytes = 512 bits
    .storeSlice(payload.beginParse())
    .endCell();
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log('=== Uninit Wallet Settlement Test (Level 1: Mirror UI Flow) ===\n');

  // 1. Derive keypair from mnemonic
  if (MNEMONIC.startsWith('your ')) {
    console.error('ERROR: Set MNEMONIC env var or edit the script constant.');
    console.error('  MNEMONIC="word1 word2 ... word24" npx tsx scripts/test-uninit-settlement.ts');
    process.exit(1);
  }

  const words = MNEMONIC.trim().split(/\s+/);
  if (words.length !== 24) {
    console.error(`ERROR: Expected 24 mnemonic words, got ${words.length}`);
    process.exit(1);
  }

  const keyPair = await mnemonicToPrivateKey(words);
  console.log('Keypair derived from mnemonic');

  // 2. Compute V4R2 wallet address
  const wallet = WalletContractV4.create({
    publicKey: keyPair.publicKey,
    workchain: 0,
  });
  const walletAddress = wallet.address;
  const walletAddressStr = walletAddress.toString({ bounceable: false, testOnly: true });
  const walletAddressRaw = walletAddress.toRawString();

  console.log('Wallet address (friendly):', walletAddressStr);
  console.log('Wallet address (raw):     ', walletAddressRaw);

  // 3. Check wallet status via TONAPI
  console.log('\n--- Checking wallet status ---');
  const acctResp = await fetch(`${TONAPI_BASE}/v2/accounts/${walletAddressRaw}`);
  if (!acctResp.ok) {
    console.error('TONAPI error:', acctResp.status, await acctResp.text());
    process.exit(1);
  }
  const acct = (await acctResp.json()) as any;
  console.log('Status:    ', acct.status);
  console.log('Balance:   ', acct.balance, 'nanoTON =', (Number(acct.balance) / 1e9).toFixed(4), 'TON');
  console.log('Interfaces:', acct.interfaces ?? '(none — uninit)');

  const isUninit = acct.status === 'uninit' || acct.status === 'nonexist';
  console.log('Is uninit: ', isUninit);

  if (!isUninit) {
    console.log('\nWARNING: Wallet is already initialized. This test is meant for uninit wallets.');
    console.log('The transaction will still work, but won\'t test the uninit→init transition.');
    console.log('To test properly, use a fresh wallet that has never sent a transaction.');
  }

  // 4. Find sender's tUSDT Jetton Wallet address
  //    Method 1: Jetton Master get_wallet_address (works even if wallet has 0 balance)
  //    Method 2: /v2/accounts/{addr}/jettons (only works if wallet has received jettons)
  console.log('\n--- Looking up sender Jetton Wallet ---');

  let senderJettonWallet: string | null = null;

  // Try Method 1: POST to get_wallet_address with typed args
  try {
    const jettonResp = await fetch(
      `${TONAPI_BASE}/v2/blockchain/accounts/${TUSDT_MASTER}/methods/get_wallet_address`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          args: [{ type: 'slice', value: walletAddressRaw }],
        }),
      },
    );
    if (jettonResp.ok) {
      const jettonData = (await jettonResp.json()) as any;
      console.log('Jetton Master response:', JSON.stringify(jettonData, null, 2));
      if (jettonData.decoded?.jetton_wallet_address) {
        senderJettonWallet = jettonData.decoded.jetton_wallet_address;
      }
    } else {
      console.log('get_wallet_address POST failed:', jettonResp.status, await jettonResp.text());
    }
  } catch (e) {
    console.log('get_wallet_address POST error:', e);
  }

  // Try Method 1b: GET with query param (simpler format)
  if (!senderJettonWallet) {
    try {
      const url = `${TONAPI_BASE}/v2/blockchain/accounts/${TUSDT_MASTER}/methods/get_wallet_address?args=${encodeURIComponent(walletAddressRaw)}`;
      const jettonResp2 = await fetch(url);
      if (jettonResp2.ok) {
        const jettonData2 = (await jettonResp2.json()) as any;
        console.log('Jetton Master GET response:', JSON.stringify(jettonData2, null, 2));
        if (jettonData2.decoded?.jetton_wallet_address) {
          senderJettonWallet = jettonData2.decoded.jetton_wallet_address;
        }
      } else {
        console.log('get_wallet_address GET failed:', jettonResp2.status);
      }
    } catch (e) {
      console.log('get_wallet_address GET error:', e);
    }
  }

  // Try Method 2: /v2/accounts/{addr}/jettons (only if wallet has received tUSDT)
  if (!senderJettonWallet) {
    console.log('Trying jettons endpoint fallback...');
    const jResp = await fetch(`${TONAPI_BASE}/v2/accounts/${walletAddressRaw}/jettons`);
    if (jResp.ok) {
      const jData = (await jResp.json()) as any;
      const usdtEntry = jData.balances?.find(
        (b: any) => {
          try { return Address.parse(b.jetton.address).equals(Address.parse(TUSDT_MASTER)); }
          catch { return false; }
        },
      );
      if (usdtEntry) {
        senderJettonWallet = usdtEntry.wallet_address.address;
        console.log('tUSDT balance:', usdtEntry.balance, '(micro-units)');
      }
    }
  }

  if (!senderJettonWallet) {
    console.error('ERROR: Could not find sender Jetton Wallet.');
    console.error('Make sure the wallet has received tUSDT.');
    process.exit(1);
  }

  console.log('Sender Jetton Wallet:', senderJettonWallet);

  // 5. Check tUSDT balance
  console.log('\n--- Checking tUSDT balance ---');
  const jBalResp = await fetch(`${TONAPI_BASE}/v2/accounts/${walletAddressRaw}/jettons`);
  const jBalData = (await jBalResp.json()) as any;
  const usdtBal = jBalData.balances?.find(
    (b: any) => {
      try {
        return Address.parse(b.jetton.address).equals(Address.parse(TUSDT_MASTER));
      } catch { return false; }
    },
  );
  const usdtBalance = parseInt(usdtBal?.balance ?? '0', 10);
  console.log('tUSDT balance:', usdtBalance, 'micro-units =', (usdtBalance / 1e6).toFixed(2), 'USDT');

  if (usdtBalance < TOTAL_AMOUNT) {
    console.error(`ERROR: Insufficient tUSDT. Need ${TOTAL_AMOUNT} (${TOTAL_AMOUNT / 1e6} USDT), have ${usdtBalance}`);
    process.exit(1);
  }

  const tonBalance = Number(acct.balance ?? 0);
  if (tonBalance < Number(GAS_ATTACH) + 50_000_000) {
    console.error(`ERROR: Insufficient TON for gas. Need ~${Number(GAS_ATTACH) / 1e9} TON, have ${tonBalance / 1e9} TON`);
    process.exit(1);
  }

  // 6. Build the transaction — EXACT same structure as UI flow
  console.log('\n--- Building transaction ---');

  // 6a. Jetton transfer body (same as frontend buildSettlementBody)
  const jettonBody = buildJettonTransferBody({
    totalAmount: TOTAL_AMOUNT,
    contractAddress: CONTRACT_ADDRESS,
    senderAddress: walletAddressRaw, // response_destination
    forwardTonAmount: FORWARD_TON,
    recipientAddress: RECIPIENT_ADDRESS,
  });
  console.log('Jetton transfer body built');

  // 6b. Internal message: wallet → sender's jetton wallet
  const internalMsg = internal({
    to: Address.parse(senderJettonWallet!),
    value: GAS_ATTACH,
    bounce: true,
    body: jettonBody,
  });
  const internalMsgCell = beginCell().store(storeMessageRelaxed(internalMsg)).endCell();
  console.log('Internal message built (to jetton wallet, value:', Number(GAS_ATTACH) / 1e9, 'TON)');

  // 6c. V4R2 signed external message body (seqno = 0 for uninit)
  const seqno = isUninit ? 0 : await fetchSeqno(walletAddressRaw);
  console.log('Seqno:', seqno);

  const walletBody = buildV4R2SignedBody(seqno, internalMsgCell, keyPair.secretKey);
  console.log('V4R2 external body built (with real signature)');

  // 6d. Wrap in external message WITH StateInit (crucial for uninit wallets)
  const walletStateInit: StateInit = {
    code: wallet.init?.code ?? null,
    data: wallet.init?.data ?? null,
  };

  let extMsg;
  if (isUninit) {
    console.log('Including StateInit (wallet deployment) in external message');
    extMsg = external({
      to: walletAddress,
      init: walletStateInit,
      body: walletBody,
    });
  } else {
    extMsg = external({
      to: walletAddress,
      body: walletBody,
    });
  }

  const boc = beginCell().store(storeMessage(extMsg)).endCell().toBoc().toString('base64');
  console.log('External message BOC built, length:', boc.length, 'chars');

  // 7. Send the transaction via TONAPI
  console.log('\n--- Sending transaction ---');
  const sendResp = await fetch(`${TONAPI_BASE}/v2/blockchain/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ boc }),
  });

  if (!sendResp.ok) {
    const errText = await sendResp.text();
    console.error('SEND FAILED:', sendResp.status, errText);
    console.log('\nThis is the key data point — if sending fails for uninit wallets,');
    console.log('the issue is at the message construction level, not TONAPI event indexing.');
    process.exit(1);
  }

  console.log('Transaction sent successfully!');
  const sendResult = (await sendResp.json()) as any;
  console.log('Response:', JSON.stringify(sendResult, null, 2));

  // 8. Wait and poll for the event/transaction
  console.log('\n--- Polling for transaction confirmation ---');
  console.log('Waiting 10 seconds for initial indexing...');
  await sleep(10000);

  // Poll wallet transactions to find our tx
  for (let attempt = 1; attempt <= 12; attempt++) {
    console.log(`\nPoll attempt ${attempt}/12...`);

    // Check via account transactions (raw blockchain data — no action parsing delay)
    const txResp = await fetch(
      `${TONAPI_BASE}/v2/blockchain/accounts/${walletAddressRaw}/transactions?limit=5`,
    );
    if (txResp.ok) {
      const txData = (await txResp.json()) as any;
      const txns = txData.transactions ?? [];
      console.log(`  Found ${txns.length} transactions`);
      for (const tx of txns) {
        console.log(`  TX hash: ${tx.hash}`);
        console.log(`    success: ${tx.success}, in_msg: ${tx.in_msg?.msg_type}`);
        console.log(`    total_fees: ${tx.total_fees} nanoTON`);
        if (tx.out_msgs?.length) {
          console.log(`    out_msgs: ${tx.out_msgs.length}`);
        }
      }
    }

    // Check via events API (this is what the app uses)
    const evtResp = await fetch(
      `${TONAPI_BASE}/v2/accounts/${walletAddressRaw}/events?limit=5`,
    );
    if (evtResp.ok) {
      const evtData = (await evtResp.json()) as any;
      const events = evtData.events ?? [];
      console.log(`  Found ${events.length} events`);
      for (const evt of events) {
        console.log(`  Event: ${evt.event_id}`);
        console.log(`    in_progress: ${evt.in_progress}`);
        console.log(`    actions: ${evt.actions?.map((a: any) => `${a.type}(${a.status})`).join(', ')}`);

        // If we find a completed event, check it
        if (!evt.in_progress) {
          const jettonActions = evt.actions?.filter(
            (a: any) => a.type === 'JettonTransfer' && a.status === 'ok',
          );
          if (jettonActions?.length > 0) {
            console.log('\n=== SUCCESS: Transaction confirmed! ===');
            console.log('Event ID:', evt.event_id);
            console.log('Jetton transfers:', jettonActions.length);
            for (const ja of jettonActions) {
              const t = ja.JettonTransfer;
              console.log(`  ${t.sender?.address} → ${t.recipient?.address}: ${t.amount}`);
            }
            console.log('\nView on Tonviewer:');
            console.log(`  https://testnet.tonviewer.com/transaction/${evt.event_id}`);
            return;
          }
        }
      }
    }

    // Also check the contract's events (how the app actually verifies)
    const contractEvtResp = await fetch(
      `${TONAPI_BASE}/v2/accounts/${CONTRACT_ADDRESS}/events?limit=5`,
    );
    if (contractEvtResp.ok) {
      const contractEvtData = (await contractEvtResp.json()) as any;
      const cEvents = contractEvtData.events ?? [];
      console.log(`  Contract events: ${cEvents.length}`);
      for (const evt of cEvents) {
        console.log(`  Contract Event: ${evt.event_id}, in_progress: ${evt.in_progress}`);
        console.log(`    actions: ${evt.actions?.map((a: any) => `${a.type}(${a.status})`).join(', ')}`);
      }
    }

    // Check wallet status change
    const statusResp = await fetch(`${TONAPI_BASE}/v2/accounts/${walletAddressRaw}`);
    if (statusResp.ok) {
      const statusData = (await statusResp.json()) as any;
      console.log(`  Wallet status now: ${statusData.status}`);
    }

    if (attempt < 12) {
      console.log('  Waiting 10 seconds...');
      await sleep(10000);
    }
  }

  console.log('\n=== TIMEOUT: Transaction not confirmed after 2 minutes ===');
  console.log('This is the expected behavior for uninit wallets if TONAPI keeps events in_progress.');
  console.log('Check manually on Tonviewer:');
  console.log(`  https://testnet.tonviewer.com/${walletAddressStr}`);
}

// ============================================================
// Utility
// ============================================================

async function fetchSeqno(address: string): Promise<number> {
  const resp = await fetch(`${TONAPI_BASE}/v2/blockchain/accounts/${address}/methods/seqno`);
  if (!resp.ok) return 0;
  const data = (await resp.json()) as any;
  if (!data.success || !data.stack?.[0]) return 0;
  const val = data.stack[0].num ?? data.stack[0].value;
  return parseInt(val, val?.startsWith('0x') ? 16 : 10);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ============================================================
// Run
// ============================================================

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
