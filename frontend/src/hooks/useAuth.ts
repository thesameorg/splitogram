import { useState, useEffect } from 'react';
import { api } from '../services/api';

interface AuthState {
  authenticated: boolean;
  loading: boolean;
  userId: number | null;
  displayName: string | null;
}

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({
    authenticated: false,
    loading: true,
    userId: null,
    displayName: null,
  });

  useEffect(() => {
    authenticate();
  }, []);

  async function authenticate() {
    try {
      const result = await api.authenticate();

      if (result.authenticated) {
        setState({
          authenticated: true,
          loading: false,
          userId: result.user.id,
          displayName: result.user.displayName,
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
            setState({
              authenticated: true,
              loading: false,
              userId: result.user.id,
              displayName: result.user.displayName,
            });
            return;
          }
        } catch {
          // Give up
        }
      }
    }

    setState({ authenticated: false, loading: false, userId: null, displayName: null });
  }

  return state;
}
