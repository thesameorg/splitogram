import { Address, toNano } from '@ton/core';
import { SplitogramSettlement } from '../../build/SplitogramSettlement/tact_SplitogramSettlement';
import { NetworkProvider } from '@ton/blueprint';

/**
 * Sets the trusted USDT Jetton Wallet address on the MAINNET contract.
 * Must be called by the owner before the contract can accept settlements.
 *
 * Before running:
 * 1. Update CONTRACT_ADDRESS below with the deployed mainnet contract address
 * 2. Get the contract's USDT Jetton Wallet by querying mainnet USDT Master:
 *    https://tonapi.io/v2/blockchain/accounts/EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs/methods/get_wallet_address?args=<contract_address_raw_hex_cell>
 *    Or use: https://tonapi.io/v2/accounts/<contract_address>/jettons/EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs
 * 3. Update JETTON_WALLET_ADDRESS below
 *
 * Usage: npx blueprint run mainnet/setJettonWallet --tonconnect
 */
export async function run(provider: NetworkProvider) {
  const CONTRACT_ADDRESS = 'EQBVVph-sYX2BI165SLXHdqluawmjXx5RWZZymeGvQ5hTDgq';
  // Contract's USDT Jetton Wallet (from mainnet USDT Master get_wallet_address)
  const JETTON_WALLET_ADDRESS =
    '0:23a2ca79a22caba7dc8294139c3d3d9f1713b03bcb752cb256ef3efd7afb1851';

  const contractAddress = Address.parse(CONTRACT_ADDRESS);
  const contract = provider.open(SplitogramSettlement.fromAddress(contractAddress));

  const jettonWalletAddress = Address.parse(JETTON_WALLET_ADDRESS);

  const currentWallet = await contract.getJettonWallet();
  console.log('Current jetton wallet:', currentWallet?.toString() ?? '(not set)');
  console.log('Setting to:', jettonWalletAddress.toString());

  await contract.send(
    provider.sender(),
    { value: toNano('0.05') },
    { $$type: 'SetJettonWallet', wallet: jettonWalletAddress },
  );

  console.log('\nSetJettonWallet transaction sent!');
  console.log('Wait ~10s, then verify with: npx blueprint run mainnet/verifyState --tonconnect');
}
