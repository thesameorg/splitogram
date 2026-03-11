import { Address } from '@ton/core';
import { SplitogramSettlement } from '../../build/SplitogramSettlement/tact_SplitogramSettlement';
import { NetworkProvider } from '@ton/blueprint';

/**
 * Reads MAINNET contract state and prints a summary.
 *
 * Usage: npx blueprint run mainnet/verifyState --tonconnect
 */
export async function run(provider: NetworkProvider) {
  const CONTRACT_ADDRESS = 'EQBVVph-sYX2BI165SLXHdqluawmjXx5RWZZymeGvQ5hTDgq';

  const contractAddress = Address.parse(CONTRACT_ADDRESS);
  const contract = provider.open(SplitogramSettlement.fromAddress(contractAddress));

  const commission = await contract.getCommission();
  const stats = await contract.getStats();
  const jettonWallet = await contract.getJettonWallet();
  const owner = await contract.getOwner();

  console.log('═══════════════════════════════════════════');
  console.log('  Splitogram Settlement — MAINNET');
  console.log('═══════════════════════════════════════════');
  console.log('');
  console.log('Contract:', contractAddress.toString());
  console.log('Owner:', owner.toString());
  console.log('Jetton Wallet:', jettonWallet?.toString() ?? '(not set)');
  console.log('Commission:', Number(commission), 'bps (', Number(commission) / 100, '%)');
  console.log('');
  console.log('── Stats ──────────────────────────────────');
  console.log('Total Processed:', Number(stats.total_processed) / 1_000_000, 'USDT');
  console.log('Total Commission:', Number(stats.total_commission) / 1_000_000, 'USDT');
  console.log('Settlement Count:', Number(stats.settlement_count));
  console.log('═══════════════════════════════════════════');
}
