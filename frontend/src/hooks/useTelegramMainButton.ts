import { useEffect, useRef } from 'react';
import { hapticImpact } from '../utils/haptic';

interface MainButtonOptions {
  text: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  show?: boolean;
}

export function useTelegramMainButton(options: MainButtonOptions) {
  const { text, onClick, disabled = false, loading = false, show = true } = options;
  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;

  // Show/hide — only depends on `show`
  useEffect(() => {
    const mainButton = window.Telegram?.WebApp?.MainButton;
    if (!mainButton) return;

    if (show) {
      mainButton.show();
      return () => {
        mainButton.hide();
      };
    } else {
      mainButton.hide();
    }
  }, [show]);

  // Text — update without toggling visibility
  useEffect(() => {
    const mainButton = window.Telegram?.WebApp?.MainButton;
    if (!mainButton || !show) return;
    mainButton.setText(text);
  }, [text, show]);

  // Enabled/disabled + progress — update without toggling visibility
  useEffect(() => {
    const mainButton = window.Telegram?.WebApp?.MainButton;
    if (!mainButton || !show) return;

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
  }, [disabled, loading, show]);

  // Click handler — use stable ref to avoid re-subscribing
  useEffect(() => {
    const mainButton = window.Telegram?.WebApp?.MainButton;
    if (!mainButton || !show) return;

    const handler = () => { hapticImpact('medium'); onClickRef.current(); };
    mainButton.onClick(handler);
    return () => {
      mainButton.offClick(handler);
    };
  }, [show]);
}
