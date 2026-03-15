import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { hapticImpact } from '../utils/haptic';

export function useTelegramBackButton(show: boolean = true, backPath?: string) {
  const navigate = useNavigate();

  useEffect(() => {
    const webApp = window.Telegram?.WebApp;
    if (!webApp) return;

    const backButton = webApp.BackButton;
    if (show) {
      backButton.show();
      const handler = () => {
        hapticImpact('light');
        if (backPath) {
          navigate(backPath, { replace: true });
        } else {
          navigate(-1);
        }
      };
      backButton.onClick(handler);
      return () => {
        backButton.offClick(handler);
        backButton.hide();
      };
    } else {
      backButton.hide();
    }
  }, [show, navigate, backPath]);
}
