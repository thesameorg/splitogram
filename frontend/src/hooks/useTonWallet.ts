import { useEffect, useRef, useState } from 'react';
import { useTonConnectUI, useTonAddress } from '@tonconnect/ui-react';
import { api } from '../services/api';
import { config } from '../config';

/**
 * Check if a user-friendly TON address belongs to testnet.
 * Testnet addresses start with 'kQ' (bounceable) or '0Q' (non-bounceable).
 */
function isTestnetAddress(friendlyAddr: string): boolean {
  return friendlyAddr.startsWith('kQ') || friendlyAddr.startsWith('0Q');
}

/**
 * Thin wrapper around TON Connect hooks.
 * Syncs wallet address to backend on connect/disconnect.
 * Rejects testnet wallets when running on mainnet.
 */
export function useTonWallet() {
  const [tonConnectUI] = useTonConnectUI();
  const rawAddress = useTonAddress(false); // raw format (0:abc...)
  const friendlyAddress = useTonAddress(true); // user-friendly (EQ...)
  const connected = !!rawAddress;
  const prevAddress = useRef<string | null>(null);
  const [networkMismatch, setNetworkMismatch] = useState(false);

  // Sync wallet address to backend when it changes
  useEffect(() => {
    if (rawAddress && rawAddress !== prevAddress.current) {
      // Reject testnet wallets on mainnet (and vice versa)
      const walletIsTestnet = friendlyAddress ? isTestnetAddress(friendlyAddress) : false;
      const appIsMainnet = config.tonNetwork === 'mainnet';
      if ((appIsMainnet && walletIsTestnet) || (!appIsMainnet && !walletIsTestnet && friendlyAddress)) {
        setNetworkMismatch(true);
        tonConnectUI.disconnect().catch(() => {});
        return;
      }

      setNetworkMismatch(false);
      prevAddress.current = rawAddress;
      api.setWallet(rawAddress).catch(() => {
        // Retry once after 2s (auth may not be ready on initial restore)
        setTimeout(() => {
          api.setWallet(rawAddress).catch(() => {});
        }, 2000);
      });
    } else if (!rawAddress && prevAddress.current) {
      prevAddress.current = null;
      api.deleteWallet().catch(() => {});
    }
  }, [rawAddress, friendlyAddress]);

  return {
    tonConnectUI,
    connected,
    rawAddress,
    friendlyAddress,
    openModal: () => tonConnectUI.openModal(),
    disconnect: () => tonConnectUI.disconnect(),
    networkMismatch,
    clearNetworkMismatch: () => setNetworkMismatch(false),
  };
}
