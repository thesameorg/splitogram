import { useTranslation } from 'react-i18next';

interface DebugPanelProps {
  walletConnected: boolean;
  walletVersion: string | null;
  friendlyAddress: string;
}

export function DebugPanel({ walletConnected, walletVersion, friendlyAddress }: DebugPanelProps) {
  const { i18n } = useTranslation();

  const rows: [string, string][] = [
    [
      'Analytics token',
      import.meta.env.VITE_TG_ANALYTICS_TOKEN
        ? `${import.meta.env.VITE_TG_ANALYTICS_TOKEN.slice(0, 20)}...`
        : '(empty)',
    ],
    [
      'Analytics SDK',
      (() => {
        const ta = (window as any).telegramAnalytics;
        if (!ta) return 'not loaded';
        return `loaded (keys: ${Object.keys(ta).join(', ')})`;
      })(),
    ],
    ['Worker URL', import.meta.env.VITE_WORKER_URL || '(empty)'],
    ['Bot username', import.meta.env.VITE_TELEGRAM_BOT_USERNAME || '(empty)'],
    ['TON network', import.meta.env.VITE_TON_NETWORK || '(empty)'],
    ['Build mode', `${import.meta.env.MODE} (prod=${import.meta.env.PROD})`],
    ['TG WebApp', window.Telegram?.WebApp ? 'loaded' : 'missing'],
    ['TG version', (window.Telegram?.WebApp as any)?.version ?? 'n/a'],
    ['TG platform', (window.Telegram?.WebApp as any)?.platform ?? 'n/a'],
    [
      'TG initData',
      window.Telegram?.WebApp?.initData
        ? `${window.Telegram.WebApp.initData.length} chars`
        : '(empty)',
    ],
    [
      'TonConnect',
      (() => {
        try {
          const tc = (window as any).tonConnectUI;
          if (tc) return `instance found, connected=${tc.connected}`;
          return 'no global instance';
        } catch {
          return 'error checking';
        }
      })(),
    ],
    [
      'Wallet',
      walletConnected
        ? `${walletVersion ?? '?'} ${friendlyAddress?.slice(0, 8)}...`
        : 'not connected',
    ],
    ['User agent', navigator.userAgent.slice(0, 60) + '...'],
    ['Screen', `${window.innerWidth}x${window.innerHeight} (dpr ${window.devicePixelRatio})`],
    ['Locale', `${navigator.language} / i18n=${i18n.language}`],
    ['Time', new Date().toISOString()],
  ];

  return (
    <div className="mt-4 rounded-xl overflow-hidden border border-tg-separator">
      <div className="bg-tg-secondary-bg px-3 py-2 text-xs font-bold text-tg-hint">Debug Info</div>
      <div className="divide-y divide-tg-separator text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-2 px-3 py-2">
            <span className="text-tg-hint shrink-0">{label}</span>
            <span className="text-tg-text text-right break-all font-mono">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
