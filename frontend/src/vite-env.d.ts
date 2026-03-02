/// <reference types="vite/client" />

export {};

interface ImportMetaEnv {
  readonly VITE_WORKER_URL: string;
  readonly VITE_TELEGRAM_BOT_USERNAME: string;
  readonly VITE_TG_ANALYTICS_TOKEN: string;
  readonly VITE_TON_MANIFEST_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface TelegramWebApp {
  ready(): void;
  backgroundColor: string;
  colorScheme: 'light' | 'dark';
  themeParams: {
    text_color?: string;
    bg_color?: string;
    hint_color?: string;
    link_color?: string;
    button_color?: string;
    button_text_color?: string;
  };
  initData: string;
  initDataUnsafe: {
    user?: {
      id: number;
      first_name: string;
      last_name?: string;
      username?: string;
      language_code?: string;
    };
    start_param?: string;
  };
  MainButton: {
    text: string;
    setText(text: string): void;
    show(): void;
    hide(): void;
    onClick(callback: () => void): void;
    offClick(callback: () => void): void;
    enable(): void;
    disable(): void;
    showProgress(leaveActive?: boolean): void;
    hideProgress(): void;
  };
  BackButton: {
    show(): void;
    hide(): void;
    onClick(callback: () => void): void;
    offClick(callback: () => void): void;
  };
  close(): void;
  expand(): void;
  openTelegramLink(url: string): void;
  HapticFeedback?: {
    impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
    notificationOccurred(type: 'error' | 'success' | 'warning'): void;
    selectionChanged(): void;
  };
  CloudStorage?: {
    getItem(key: string, callback: (err: any, value: string | null) => void): void;
    setItem(key: string, value: string, callback?: (err: any) => void): void;
    removeItem(key: string, callback?: (err: any) => void): void;
  };
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }
}
