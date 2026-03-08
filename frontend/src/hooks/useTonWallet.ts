import { useEffect, useRef } from 'react';
import { useTonConnectUI, useTonAddress } from '@tonconnect/ui-react';
import { api } from '../services/api';

/**
 * Thin wrapper around TON Connect hooks.
 * Syncs wallet address to backend on connect/disconnect.
 */
export function useTonWallet() {
  const [tonConnectUI] = useTonConnectUI();
  const rawAddress = useTonAddress(false); // raw format (0:abc...)
  const friendlyAddress = useTonAddress(true); // user-friendly (EQ...)
  const connected = !!rawAddress;
  const prevAddress = useRef<string | null>(null);

  // Sync wallet address to backend when it changes
  useEffect(() => {
    if (rawAddress && rawAddress !== prevAddress.current) {
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
  }, [rawAddress]);

  return {
    tonConnectUI,
    connected,
    rawAddress,
    friendlyAddress,
    openModal: () => tonConnectUI.openModal(),
    disconnect: () => tonConnectUI.disconnect(),
  };
}
