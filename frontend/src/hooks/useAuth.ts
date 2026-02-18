import { useState, useEffect } from 'react';
import { apiRequest, setSessionId, getSessionId, clearSession } from '../services/api';

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
    // If we have an existing session, try to validate it
    const existingSession = getSessionId();

    try {
      const webApp = window.Telegram?.WebApp;
      const initData = webApp?.initData;

      const body: Record<string, string> = {};
      if (existingSession) body.sessionId = existingSession;
      if (initData) body.initData = initData;

      const result = await apiRequest<{
        authenticated: boolean;
        sessionId: string;
        user: { id: number; displayName?: string; first_name?: string; last_name?: string };
        expiresAt: number;
      }>('/api/v1/auth', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      if (result.authenticated) {
        setSessionId(result.sessionId);
        const displayName =
          result.user.displayName ||
          [result.user.first_name, result.user.last_name].filter(Boolean).join(' ');
        setState({
          authenticated: true,
          loading: false,
          userId: result.user.id,
          displayName,
        });
        return;
      }
    } catch {
      clearSession();
    }

    setState({ authenticated: false, loading: false, userId: null, displayName: null });
  }

  return state;
}
