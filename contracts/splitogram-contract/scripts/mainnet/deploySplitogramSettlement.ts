import { Address, toNano } from '@ton/core';
import { SplitogramSettlement } from '../../build/SplitogramSettlement/tact_SplitogramSettlement';
import { NetworkProvider } from '@ton/blueprint';

export async function run(provider: NetworkProvider) {
  // Mainnet owner wallet (W5)
  const owner = Address.parse('UQCZRBAItQRFbE3HkfTZerfOgcGiucYSL3ZAd3x0eyAIfxqe');

  const contract = provider.open(
    await SplitogramSettlement.fromInit(owner, 100n), // 1% commission
  );

  await contract.send(
    provider.sender(),
    { value: toNano('0.5') },
    { $$type: 'Deploy', queryId: 0n },
  );

  await provider.waitForDeploy(contract.address);

  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log('  MAINNET Contract Deployed!');
  console.log('═══════════════════════════════════════════');
  console.log('Contract:', contract.address.toString());
  console.log('Owner:', owner.toString());
  console.log('Commission:', await contract.getCommission(), 'bps');
  console.log('');
  console.log('NEXT STEPS:');
  console.log('1. Update mainnet/setJettonWallet.ts with the contract address above');
  console.log('2. Query USDT Master for contract jetton wallet address');
  console.log('3. Run: npx blueprint run mainnet/setJettonWallet --tonconnect');
  console.log('═══════════════════════════════════════════');
}
