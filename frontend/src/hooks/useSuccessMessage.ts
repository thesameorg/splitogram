import { useState, useCallback, useRef } from 'react';

/**
 * Auto-dismissing success message state.
 * Usage: const { success, showSuccess, clearSuccess } = useSuccessMessage();
 */
export function useSuccessMessage(duration = 2000) {
  const [success, setSuccess] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const showSuccess = useCallback(
    (message: string) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setSuccess(message);
      timerRef.current = setTimeout(() => setSuccess(null), duration);
    },
    [duration],
  );

  const clearSuccess = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setSuccess(null);
  }, []);

  return { success, showSuccess, clearSuccess };
}
