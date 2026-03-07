import { Address, beginCell, toNano } from '@ton/core';
import { NetworkProvider } from '@ton/blueprint';

// Jetton wallet addresses for each wallet owner (from TONAPI)
const JETTON_WALLETS: Record<string, string> = {
  '0:31dd3ab8b3ceed0156b47b826524d34d20cdbd3654c863b85471675149216ba3':
    '0:002d244350f97a3f3f9befd979825c2b8959cf6004429199c0a9badd5847fb44', // Wallet A
  '0:4cb1bc613596e4e28084e2de91fe13a59bcffbf83e2fa284e743177602b5c6e7':
    '0:b6c189a77c6212441d923485796947f0923dd06caee7b59cc286a5580d2324be', // Wallet B
  '0:28049cddd3a0f7c73c6b742885dfc6675723950c24d93ca9909eb58efb645f53':
    '0:c0265ce987e860efd650270bdd0da41156307c9378e8db703cdb69874584955f', // Wallet C
};

/**
 * Sends a test settlement: Connected Wallet → Contract → (remainder to Wallet B, commission to Wallet C).
 *
 * Automatically detects which wallet is connected and uses its Jetton Wallet.
 *
 * Usage: npx blueprint run testSettlement --testnet --tonconnect
 */
export async function run(provider: NetworkProvider) {
  // ── Detect connected wallet's Jetton Wallet ────────────────
  const connectedAddress = provider.sender().address;
  if (!connectedAddress) {
    throw new Error('No wallet connected');
  }
  const connectedRaw = connectedAddress.toRawString();
  const jettonWalletRaw = JETTON_WALLETS[connectedRaw];
  if (!jettonWalletRaw) {
    throw new Error(
      `Unknown wallet connected: ${connectedRaw}\nKnown wallets: ${Object.keys(JETTON_WALLETS).join(', ')}`,
    );
  }
  const senderJettonWallet = Address.parseRaw(jettonWalletRaw);

  console.log('Connected wallet:', connectedAddress.toString());
  console.log('Jetton wallet:', senderJettonWallet.toString());

  // ── Addresses ─────────────────────────────────────────────
  const walletB = Address.parse('0QBMsbxhNZbk4oCEYt6R_hOlm8_7-D4vooTnQxd2ArXG5yOS');
  const contractAddress = Address.parse('EQBWECX8nJ3lk-90IdgLHoINEYvpmACCGnrqT0rTYH0mjgRu');

  // ── Settlement Parameters ─────────────────────────────────
  const amountUSDT = 100_000_000n; // 100 tUSDT (6 decimals)

  // Build Jetton transfer body (TEP-74)
  // forward_payload is stored INLINE (not as ref) — the jetton wallet passes
  // remaining bits as-is in the transfer_notification to the contract.
  const body = beginCell()
    .storeUint(0xf8a7ea5, 32) // op: jetton_transfer
    .storeUint(0, 64) // query_id
    .storeCoins(amountUSDT) // jetton amount
    .storeAddress(contractAddress) // destination (contract)
    .storeAddress(connectedAddress) // response_destination (excess gas back to sender)
    .storeBit(false) // no custom_payload
    .storeCoins(toNano('0.4')) // forward_ton_amount (gas for contract: 2 × 0.15 TON outgoing + overhead)
    .storeUint(0, 32) // forward_payload inline: op = 0 (settlement)
    .storeAddress(walletB) // forward_payload inline: recipient
    .endCell();

  // Send the Jetton transfer
  await provider.sender().send({
    to: senderJettonWallet,
    value: toNano('0.5'), // TON for gas (covers forward + contract's two outgoing transfers)
    body: body,
  });

  console.log('\nSettlement transaction sent!');
  console.log('Amount:', Number(amountUSDT) / 1_000_000, 'tUSDT');
  console.log('Recipient (Wallet B):', walletB.toString());
  console.log('Contract:', contractAddress.toString());
  console.log('\nCheck on Tonviewer:');
  console.log(`  https://testnet.tonviewer.com/${contractAddress.toString()}`);
}
