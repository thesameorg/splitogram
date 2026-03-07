import { Address, toNano } from '@ton/core';
import { SplitogramSettlement } from '../build/SplitogramSettlement/tact_SplitogramSettlement';
import { NetworkProvider } from '@ton/blueprint';

/**
 * Sets the trusted USDT Jetton Wallet address on the contract.
 * Must be called by the owner before the contract can accept settlements.
 *
 * Usage: npx blueprint run setJettonWallet --testnet --tonconnect
 */
export async function run(provider: NetworkProvider) {
    const contractAddress = Address.parse('EQBWECX8nJ3lk-90IdgLHoINEYvpmACCGnrqT0rTYH0mjgRu');
    const contract = provider.open(SplitogramSettlement.fromAddress(contractAddress));

    // Contract's USDT Jetton Wallet address (from jetton master get_wallet_address)
    const jettonWalletAddress = Address.parseRaw('0:dcda54490e86ba8f7d55cd19955915611dfe026e9d75f13f9f45480bb896c047');

    const currentWallet = await contract.getJettonWallet();
    console.log('Current jetton wallet:', currentWallet?.toString() ?? '(not set)');
    console.log('Setting to:', jettonWalletAddress.toString());

    await contract.send(
        provider.sender(),
        { value: toNano('0.05') },
        { $$type: 'SetJettonWallet', wallet: jettonWalletAddress }
    );

    console.log('\nSetJettonWallet transaction sent!');
    console.log('Wait ~10s, then verify with: npx blueprint run verifyState --testnet --tonconnect');
}
