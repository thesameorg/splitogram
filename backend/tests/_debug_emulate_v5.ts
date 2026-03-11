/**
 * Debug script: emulate a Jetton settlement via TONAPI for a V5R1 (W5) wallet.
 * Run: cd contracts/splitogram-contract && npx tsx ../../backend/tests/_debug_emulate_v5.ts
 *
 * Testnet sender: 0QAx3Tq4s87tAVa0e4JlJNNNIM29NlTIY7hUcWdRSSFro8v7
 */
import { estimateSettlementGas, tonapiBaseUrl, tonapiHeaders } from '../src/services/tonapi';
import type { Env } from '../src/env';

// --- Config ---
const SENDER = '0QAx3Tq4s87tAVa0e4JlJNNNIM29NlTIY7hUcWdRSSFro8v7';
const SENDER_JETTON = '0:002d244350f97a3f3f9befd979825c2b8959cf6004429199c0a9badd5847fb44';
const CONTRACT = 'EQBWECX8nJ3lk-90IdgLHoINEYvpmACCGnrqT0rTYH0mjgRu';
const RECIPIENT = '0QBMsbxhNZbk4oCEYt6R_hOlm8_7-D4vooTnQxd2ArXG5yOS';
const FORWARD_TON = 300_000_000;
const TOTAL_AMOUNT = 10_000_000; // 10 tUSDT (6 decimals)

// Minimal env stub for testnet
const env = { TON_NETWORK: 'testnet', TONAPI_KEY: '' } as Env;

async function main() {
  // Verify wallet is V5
  const baseUrl = tonapiBaseUrl(env);
  const acctResp = await fetch(`${baseUrl}/v2/accounts/${SENDER}`, {
    headers: tonapiHeaders(env),
  });
  const acct = (await acctResp.json()) as any;
  console.log('Wallet:', acct.interfaces, 'balance:', acct.balance, 'status:', acct.status);

  if (!acct.interfaces?.some((i: string) => i.includes('wallet_v5'))) {
    console.error('Expected V5 wallet, got:', acct.interfaces);
    process.exit(1);
  }

  // Run emulation
  console.log('\nEmulating settlement...');
  const fees = await estimateSettlementGas({
    env,
    senderAddress: SENDER,
    senderJettonWallet: SENDER_JETTON,
    contractAddress: CONTRACT,
    recipientAddress: RECIPIENT,
    totalAmount: TOTAL_AMOUNT,
    forwardTonAmount: FORWARD_TON,
    walletInterfaces: acct.interfaces,
  });

  if (fees !== null) {
    console.log(`\nEstimated gas: ${fees} nanoTON (${(fees / 1e9).toFixed(4)} TON)`);
  } else {
    console.error('\nEmulation failed (returned null)');
    process.exit(1);
  }
}

main().catch(console.error);
