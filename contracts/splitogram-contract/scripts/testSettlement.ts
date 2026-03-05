import { Address, beginCell, toNano } from '@ton/core';
import { NetworkProvider } from '@ton/blueprint';

/**
 * Sends a test settlement: Wallet A → Contract → (remainder to Wallet B, commission to Wallet C).
 *
 * This script builds a Jetton transfer message from Wallet A's USDT Jetton Wallet
 * to the Splitogram contract, with Wallet B as the recipient in the forward_payload.
 *
 * Usage: npx blueprint run testSettlement --testnet --tonconnect
 * Connect as Wallet A.
 */
export async function run(provider: NetworkProvider) {
    // ── Addresses ─────────────────────────────────────────────
    const walletB = Address.parse('0QBMsbxhNZbk4oCEYt6R_hOlm8_7-D4vooTnQxd2ArXG5yOS');

    // The Splitogram contract address (fill in after deployment)
    const contractAddress = Address.parse('TODO_FILL_CONTRACT_ADDRESS');

    // Wallet A's USDT Jetton Wallet address (find on Tonviewer → Wallet A → Jettons tab → tUSDT)
    const walletA_JettonWallet = Address.parse('TODO_FILL_WALLET_A_JETTON_WALLET');

    // ── Settlement Parameters ─────────────────────────────────
    const amountUSDT = 100_000_000n; // 100 tUSDT (6 decimals)

    // Encode recipient in forward_payload
    const forwardPayload = beginCell()
        .storeUint(0, 32) // op = 0 (settlement)
        .storeAddress(walletB)
        .endCell();

    // Build Jetton transfer body (TEP-74)
    const body = beginCell()
        .storeUint(0xf8a7ea5, 32) // op: jetton_transfer
        .storeUint(0, 64) // query_id
        .storeCoins(amountUSDT) // jetton amount
        .storeAddress(contractAddress) // destination (contract)
        .storeAddress(walletB) // response_destination (excess gas → Wallet A or B)
        .storeBit(false) // no custom_payload
        .storeCoins(toNano('0.25')) // forward_ton_amount (gas for contract to process)
        .storeBit(true) // forward_payload in ref
        .storeRef(forwardPayload)
        .endCell();

    // Send the Jetton transfer
    await provider.sender().send({
        to: walletA_JettonWallet,
        value: toNano('0.35'), // TON for gas (covers forward + contract's two outgoing transfers)
        body: body,
    });

    console.log('Settlement transaction sent!');
    console.log('Amount:', Number(amountUSDT) / 1_000_000, 'tUSDT');
    console.log('Recipient (Wallet B):', walletB.toString());
    console.log('Contract:', contractAddress.toString());
    console.log('');
    console.log('Check on Tonviewer:');
    console.log(`  https://testnet.tonviewer.com/${contractAddress.toString()}`);
}
