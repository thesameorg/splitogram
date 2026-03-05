import { Address } from '@ton/core';
import { SplitogramSettlement } from '../build/SplitogramSettlement/tact_SplitogramSettlement';
import { NetworkProvider } from '@ton/blueprint';

/**
 * Reads contract state and prints a summary.
 *
 * Usage: npx blueprint run verifyState --testnet --tonconnect
 */
export async function run(provider: NetworkProvider) {
    // Fill in after deployment
    const contractAddress = Address.parse('TODO_FILL_CONTRACT_ADDRESS');

    const contract = provider.open(SplitogramSettlement.fromAddress(contractAddress));

    const commission = await contract.getCommission();
    const stats = await contract.getStats();
    const jettonWallet = await contract.getJettonWallet();
    const owner = await contract.getOwner();

    console.log('═══════════════════════════════════════════');
    console.log('  Splitogram Settlement Contract State');
    console.log('═══════════════════════════════════════════');
    console.log('');
    console.log('Contract:', contractAddress.toString());
    console.log('Owner:', owner.toString());
    console.log('Jetton Wallet:', jettonWallet?.toString() ?? '(not set)');
    console.log('Commission:', Number(commission), 'bps (', Number(commission) / 100, '%)');
    console.log('');
    console.log('── Stats ──────────────────────────────────');
    console.log(
        'Total Processed:',
        Number(stats.total_processed) / 1_000_000,
        'USDT'
    );
    console.log(
        'Total Commission:',
        Number(stats.total_commission) / 1_000_000,
        'USDT'
    );
    console.log('Settlement Count:', Number(stats.settlement_count));
    console.log('═══════════════════════════════════════════');
}
