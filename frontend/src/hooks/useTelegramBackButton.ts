import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export function useTelegramBackButton(show: boolean = true) {
  const navigate = useNavigate();

  useEffect(() => {
    const webApp = window.Telegram?.WebApp;
    if (!webApp) return;

    const backButton = webApp.BackButton;
    if (show) {
      backButton.show();
      const handler = () => navigate(-1);
      backButton.onClick(handler);
      return () => {
        backButton.offClick(handler);
        backButton.hide();
      };
    } else {
      backButton.hide();
    }
  }, [show, navigate]);
}
