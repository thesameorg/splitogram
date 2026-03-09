import { Address, toNano } from '@ton/core';
import { SplitogramSettlement } from '../build/SplitogramSettlement/tact_SplitogramSettlement';
import { NetworkProvider } from '@ton/blueprint';

/**
 * Tests owner operations: UpdateCommission + WithdrawTon.
 *
 * 1. Reads current commission (should be 100 bps = 1%)
 * 2. Updates commission to 200 bps (2%)
 * 3. Reads commission again to verify
 * 4. Restores commission back to 100 bps
 * 5. Withdraws 0.1 TON from contract
 *
 * Usage: npx blueprint run testOwnerOps --testnet --tonconnect
 * Connect as Wallet C (owner).
 */
export async function run(provider: NetworkProvider) {
  const contractAddress = Address.parse('EQDtl5xbPS-xn1NmAVevO8ahWWO8GZmGh5KuTywZjYQOFuPW');
  const contract = provider.open(SplitogramSettlement.fromAddress(contractAddress));

  // Step 1: Read current commission
  const before = await contract.getCommission();
  console.log(`\n1. Current commission: ${before} bps (${Number(before) / 100}%)`);

  // Step 2: Update commission to 200 bps (2%)
  console.log('\n2. Updating commission to 200 bps (2%)...');
  await contract.send(
    provider.sender(),
    { value: toNano('0.05') },
    { $$type: 'UpdateCommission', new_commission: 200n },
  );
  console.log('   Transaction sent. Waiting 10s for confirmation...');
  await new Promise((r) => setTimeout(r, 10000));

  // Step 3: Verify new commission
  const after = await contract.getCommission();
  console.log(`\n3. Commission after update: ${after} bps (${Number(after) / 100}%)`);
  if (after === 200n) {
    console.log('   UpdateCommission: PASSED');
  } else {
    console.log(`   UpdateCommission: FAILED (expected 200, got ${after})`);
  }

  // Step 4: Restore commission back to 100 bps
  console.log('\n4. Restoring commission to 100 bps (1%)...');
  await contract.send(
    provider.sender(),
    { value: toNano('0.05') },
    { $$type: 'UpdateCommission', new_commission: 100n },
  );
  console.log('   Transaction sent. Waiting 10s...');
  await new Promise((r) => setTimeout(r, 10000));

  const restored = await contract.getCommission();
  console.log(`   Commission restored: ${restored} bps (${Number(restored) / 100}%)`);

  // Step 5: Check contract TON balance and withdraw 0.1 TON
  console.log('\n5. Withdrawing 0.1 TON from contract...');
  await contract.send(
    provider.sender(),
    { value: toNano('0.05') },
    { $$type: 'WithdrawTon', amount: toNano('0.1') },
  );
  console.log('   Withdraw transaction sent.');

  console.log('\n══════════════════════════════════════');
  console.log('  Owner operations test complete!');
  console.log('══════════════════════════════════════');
}
