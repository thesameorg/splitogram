import { Address, toNano } from '@ton/core';
import { SplitogramSettlement } from '../build/SplitogramSettlement/tact_SplitogramSettlement';
import { NetworkProvider } from '@ton/blueprint';

export async function run(provider: NetworkProvider) {
  // Wallet C (Fee Collector / Owner)
  const owner = Address.parse('0QAoBJzd06D3xzxrdCiF38ZnVyOVDCTZPKmQnrWO-2RfU9pq');

  const contract = provider.open(
    await SplitogramSettlement.fromInit(owner, 100n), // 1% commission
  );

  await contract.send(
    provider.sender(),
    { value: toNano('0.5') },
    { $$type: 'Deploy', queryId: 0n },
  );

  await provider.waitForDeploy(contract.address);

  console.log('Contract deployed at:', contract.address.toString());
  console.log('Owner:', owner.toString());
  console.log('Commission:', await contract.getCommission(), 'bps');
}
