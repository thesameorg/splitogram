import { useEffect } from 'react';

interface MainButtonOptions {
  text: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  show?: boolean;
}

export function useTelegramMainButton(options: MainButtonOptions) {
  const { text, onClick, disabled = false, loading = false, show = true } = options;

  useEffect(() => {
    const webApp = window.Telegram?.WebApp;
    if (!webApp) return;

    const mainButton = webApp.MainButton;

    if (show) {
      mainButton.setText(text);
      mainButton.show();
      if (disabled || loading) {
        mainButton.disable();
      } else {
        mainButton.enable();
      }
      if (loading) {
        mainButton.showProgress(false);
      } else {
        mainButton.hideProgress();
      }
      mainButton.onClick(onClick);

      return () => {
        mainButton.offClick(onClick);
        mainButton.hide();
      };
    } else {
      mainButton.hide();
    }
  }, [text, onClick, disabled, loading, show]);
}
