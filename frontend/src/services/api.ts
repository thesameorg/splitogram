import { config } from '../config';

const SESSION_KEY = 'splitogram_session_id';

export function getSessionId(): string | null {
  return localStorage.getItem(SESSION_KEY);
}

export function setSessionId(id: string): void {
  localStorage.setItem(SESSION_KEY, id);
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public errorCode: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const sessionId = getSessionId();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (sessionId) {
    headers['Authorization'] = `Bearer ${sessionId}`;
  }

  const response = await fetch(`${config.apiBaseUrl}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({
      error: 'unknown_error',
      detail: 'Unknown error',
    }));
    throw new ApiError(response.status, body.error, body.detail);
  }

  return response.json();
}
