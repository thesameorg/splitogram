/**
 * Debug script: emulate a Jetton settlement via TONAPI for a V4R2 wallet.
 * Run: cd contracts/splitogram-contract && npx tsx ../../backend/tests/_debug_emulate_v4.ts
 *
 * Testnet sender: 0QDzC7zwNFirW5jXeu-EjXfJCA8w7KsZcd1SYlaHQaPHLXKL
 */
import { estimateSettlementGas, tonapiBaseUrl, tonapiHeaders } from '../src/services/tonapi';
import type { Env } from '../src/env';

// --- Config ---
const SENDER = '0QDzC7zwNFirW5jXeu-EjXfJCA8w7KsZcd1SYlaHQaPHLXKL';
const SENDER_JETTON = '0:de8391d6285b0cac5f31b34de83029e335b5ebda18d805cd33f6df3007bbc0ae';
const CONTRACT = 'EQBWECX8nJ3lk-90IdgLHoINEYvpmACCGnrqT0rTYH0mjgRu';
const RECIPIENT = '0QBMsbxhNZbk4oCEYt6R_hOlm8_7-D4vooTnQxd2ArXG5yOS';
const FORWARD_TON = 300_000_000;
const TOTAL_AMOUNT = 10_000_000; // 10 tUSDT (6 decimals)

// Minimal env stub for testnet
const env = { TON_NETWORK: 'testnet', TONAPI_KEY: '' } as Env;

async function main() {
  // Verify wallet is V4
  const baseUrl = tonapiBaseUrl(env);
  const acctResp = await fetch(`${baseUrl}/v2/accounts/${SENDER}`, {
    headers: tonapiHeaders(env),
  });
  const acct = (await acctResp.json()) as any;
  console.log('Wallet:', acct.interfaces, 'balance:', acct.balance, 'status:', acct.status);

  if (!acct.interfaces?.some((i: string) => i.includes('wallet_v4'))) {
    console.error('Expected V4 wallet, got:', acct.interfaces);
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
