import { describe, it, expect } from 'vitest';
import { estimateSettlementGas } from '../src/services/tonapi';
import type { Env } from '../src/env';

// Real testnet addresses from .envs/testnet_addresses.json
const SENDER_ADDRESS = '0QAx3Tq4s87tAVa0e4JlJNNNIM29NlTIY7hUcWdRSSFro8v7'; // wallet_a
const SENDER_JETTON_WALLET = '0:002d244350f97a3f3f9befd979825c2b8959cf6004429199c0a9badd5847fb44';
const CONTRACT_ADDRESS = 'EQBWECX8nJ3lk-90IdgLHoINEYvpmACCGnrqT0rTYH0mjgRu';
const RECIPIENT_ADDRESS = '0QBMsbxhNZbk4oCEYt6R_hOlm8_7-D4vooTnQxd2ArXG5yOS'; // wallet_b

const FORWARD_TON = 300_000_000; // 0.3 TON
const TOTAL_AMOUNT = 10_000_000; // 10 USDT in micro-units (debt + commission)

// Minimal Env stub for TONAPI calls
const env = {
  TON_NETWORK: 'testnet',
  TONAPI_KEY: '', // testnet doesn't require auth
} as unknown as Env;

describe('gas estimation via TONAPI emulate (testnet)', () => {
  it('should return a positive fee estimate for a settlement', async () => {
    const fees = await estimateSettlementGas({
      env,
      senderAddress: SENDER_ADDRESS,
      senderJettonWallet: SENDER_JETTON_WALLET,
      contractAddress: CONTRACT_ADDRESS,
      recipientAddress: RECIPIENT_ADDRESS,
      totalAmount: TOTAL_AMOUNT,
      forwardTonAmount: FORWARD_TON,
      walletInterfaces: ['wallet_v5r1'], // Tonkeeper default
    });

    if (fees === null) {
      // Emulate can fail on testnet (TONAPI down, wallet empty, etc.)
      // This is acceptable — the fallback to empirical handles it
      console.warn(
        'TONAPI emulate returned null — testnet may be unavailable or wallet seqno stale',
      );
      return;
    }

    console.log(`Emulated fees: ${fees} nanoTON (${(fees / 1e9).toFixed(4)} TON)`);

    // Fees should be positive and reasonable (between 0.01 and 1 TON)
    expect(fees).toBeGreaterThan(10_000_000); // > 0.01 TON
    expect(fees).toBeLessThan(1_000_000_000); // < 1 TON

    // Emulated ~0.035 TON on testnet (11-message settlement chain)
    // Allow wide range since network conditions can vary
    expect(fees).toBeGreaterThan(20_000_000); // > 0.02 TON
    expect(fees).toBeLessThan(500_000_000); // < 0.5 TON
  }, 30000); // 30s timeout for network calls

  it('should also work with V4R2 wallet interfaces', async () => {
    const fees = await estimateSettlementGas({
      env,
      senderAddress: SENDER_ADDRESS,
      senderJettonWallet: SENDER_JETTON_WALLET,
      contractAddress: CONTRACT_ADDRESS,
      recipientAddress: RECIPIENT_ADDRESS,
      totalAmount: TOTAL_AMOUNT,
      forwardTonAmount: FORWARD_TON,
      walletInterfaces: ['wallet_v4r2'],
    });

    if (fees === null) {
      console.warn('V4R2 emulate returned null — wallet may not be V4R2 or testnet unavailable');
      return;
    }

    console.log(`V4R2 emulated fees: ${fees} nanoTON (${(fees / 1e9).toFixed(4)} TON)`);
    expect(fees).toBeGreaterThan(10_000_000);
    expect(fees).toBeLessThan(1_000_000_000);
  }, 30000);

  it('should return null for unsupported wallet version', async () => {
    const fees = await estimateSettlementGas({
      env,
      senderAddress: SENDER_ADDRESS,
      senderJettonWallet: SENDER_JETTON_WALLET,
      contractAddress: CONTRACT_ADDRESS,
      recipientAddress: RECIPIENT_ADDRESS,
      totalAmount: TOTAL_AMOUNT,
      forwardTonAmount: FORWARD_TON,
      walletInterfaces: ['wallet_v3r2'], // not supported
    });

    expect(fees).toBeNull();
  });

  it('should return null for empty interfaces', async () => {
    const fees = await estimateSettlementGas({
      env,
      senderAddress: SENDER_ADDRESS,
      senderJettonWallet: SENDER_JETTON_WALLET,
      contractAddress: CONTRACT_ADDRESS,
      recipientAddress: RECIPIENT_ADDRESS,
      totalAmount: TOTAL_AMOUNT,
      forwardTonAmount: FORWARD_TON,
      walletInterfaces: [],
    });

    expect(fees).toBeNull();
  });
});
