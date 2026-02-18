export interface ErrorResponse {
  error: string;
  detail: string;
}

export function errorResponse(error: string, detail: string): ErrorResponse {
  return { error, detail };
}

export const AuthErrors = {
  missingInitData: (): ErrorResponse => ({
    error: 'missing_init_data',
    detail: 'initData is required for authentication',
  }),

  invalidInitData: (reason?: string): ErrorResponse => ({
    error: 'invalid_init_data',
    detail: reason ?? 'Invalid or malformed initData',
  }),

  expiredInitData: (): ErrorResponse => ({
    error: 'expired_init_data',
    detail: 'initData has expired (older than 1 hour)',
  }),
};
