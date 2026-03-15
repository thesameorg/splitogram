import { useState, useEffect } from 'react';
import i18n, { hasPersistedLocale } from '../i18n';
import { api } from '../services/api';

interface AuthState {
  authenticated: boolean;
  loading: boolean;
  userId: number | null;
  displayName: string | null;
  isAdmin: boolean;
  isNewUser: boolean;
}

function applyLocale(locale: string) {
  // Don't override if user previously chose a language (persisted in CloudStorage)
  if (hasPersistedLocale) return;
  if (locale && locale !== i18n.language) {
    i18n.changeLanguage(locale);
  }
}

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({
    authenticated: false,
    loading: true,
    userId: null,
    displayName: null,
    isAdmin: false,
    isNewUser: false,
  });

  useEffect(() => {
    authenticate();
  }, []);

  async function authenticate() {
    try {
      const result = await api.authenticate();

      if (result.authenticated) {
        applyLocale(result.locale);
        setState({
          authenticated: true,
          loading: false,
          userId: result.user.id,
          displayName: result.user.displayName,
          isAdmin: result.isAdmin ?? false,
          isNewUser: result.isNewUser ?? false,
        });
        return;
      }
    } catch {
      // If initData isn't available yet (first frame), retry once after a short delay
      const initData = window.Telegram?.WebApp?.initData;
      if (!initData) {
        await new Promise((r) => setTimeout(r, 150));
        try {
          const result = await api.authenticate();
          if (result.authenticated) {
            applyLocale(result.locale);
            setState({
              authenticated: true,
              loading: false,
              userId: result.user.id,
              displayName: result.user.displayName,
              isAdmin: result.isAdmin ?? false,
              isNewUser: result.isNewUser ?? false,
            });
            return;
          }
        } catch {
          // Give up
        }
      }
    }

    setState({
      authenticated: false,
      loading: false,
      userId: null,
      displayName: null,
      isAdmin: false,
      isNewUser: false,
    });
  }

  return state;
}
