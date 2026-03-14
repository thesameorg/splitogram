import { useCallback, useEffect, useRef, useState } from 'react';
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
 *
 * Only calls deleteWallet on explicit user disconnect — not when TON Connect
 * has no local session (e.g. different device, cleared storage).
 */
export function useTonWallet() {
  const [tonConnectUI] = useTonConnectUI();
  const rawAddress = useTonAddress(false); // raw format (0:abc...)
  const friendlyAddress = useTonAddress(true); // user-friendly (EQ...)
  const connected = !!rawAddress;
  const prevAddress = useRef<string | null>(null);
  const [networkMismatch, setNetworkMismatch] = useState(false);
  // Track whether disconnect was triggered by user action (not session loss)
  const userDisconnecting = useRef(false);

  // Sync wallet address to backend when it changes
  useEffect(() => {
    if (rawAddress && rawAddress !== prevAddress.current) {
      // Reject testnet wallets on mainnet (and vice versa)
      const walletIsTestnet = friendlyAddress ? isTestnetAddress(friendlyAddress) : false;
      const appIsMainnet = config.tonNetwork === 'mainnet';
      if (
        (appIsMainnet && walletIsTestnet) ||
        (!appIsMainnet && !walletIsTestnet && friendlyAddress)
      ) {
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
      // Only delete from backend if user explicitly disconnected
      if (userDisconnecting.current) {
        userDisconnecting.current = false;
        api.deleteWallet().catch(() => {});
      }
    }
  }, [rawAddress, friendlyAddress]);

  const handleDisconnect = useCallback(() => {
    userDisconnecting.current = true;
    return tonConnectUI.disconnect();
  }, [tonConnectUI]);

  return {
    tonConnectUI,
    connected,
    rawAddress,
    friendlyAddress,
    openModal: () => tonConnectUI.openModal(),
    disconnect: handleDisconnect,
    networkMismatch,
    clearNetworkMismatch: () => setNetworkMismatch(false),
  };
}
