import { useTranslation } from 'react-i18next';
import { truncateAddress } from '../../utils/ton';
import { config } from '../../config';

interface WalletSectionProps {
  walletConnected: boolean;
  friendlyAddress: string;
  walletVersion: string | null;
  showBalances: boolean;
  balancesLoading: boolean;
  tonBalance: string | null;
  usdtBalance: string | null;
  onToggleBalances: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
}

export function WalletSection({
  walletConnected,
  friendlyAddress,
  walletVersion,
  showBalances,
  balancesLoading,
  tonBalance,
  usdtBalance,
  onToggleBalances,
  onConnect,
  onDisconnect,
}: WalletSectionProps) {
  const { t } = useTranslation();

  return (
    <div className="mb-4">
      <label className="block text-sm font-medium mb-1 text-tg-hint">{t('account.wallet')}</label>
      {walletConnected ? (
        <div className="p-3 card rounded-2xl">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <span className="font-medium">{truncateAddress(friendlyAddress)}</span>
              {walletVersion && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-tg-secondary-bg text-tg-hint">
                  {walletVersion}
                </span>
              )}
              {config.tonNetwork === 'testnet' && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-app-warning-bg text-app-warning">
                  testnet
                </span>
              )}
              <button
                onClick={onToggleBalances}
                className="p-1 text-tg-hint hover:text-tg-text transition-colors"
                title={showBalances ? t('account.hideBalances') : t('account.showBalances')}
              >
                {showBalances ? (
                  <svg
                    className="w-4 h-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                  </svg>
                ) : (
                  <svg
                    className="w-4 h-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
            <button
              onClick={() => {
                if (window.confirm(t('account.confirmDisconnectWallet'))) {
                  onDisconnect();
                }
              }}
              className="text-tg-destructive text-sm font-medium"
            >
              {t('account.disconnectWallet')}
            </button>
          </div>
          {showBalances && (
            <div className="flex gap-4 mt-2 pt-2 border-t border-ghost text-sm">
              {balancesLoading ? (
                <span className="text-tg-hint">...</span>
              ) : (
                <>
                  {tonBalance !== null && (
                    <span className="text-tg-hint">
                      <span className="font-medium text-tg-text">{tonBalance}</span> TON
                    </span>
                  )}
                  {usdtBalance !== null && (
                    <span className="text-tg-hint">
                      <span className="font-medium text-tg-text">{usdtBalance}</span> USDT
                    </span>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      ) : (
        <button
          onClick={onConnect}
          className="w-full p-3 bg-tg-button text-tg-button-text rounded-xl font-medium"
        >
          {t('account.connectWallet')}
        </button>
      )}
    </div>
  );
}
