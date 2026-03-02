const hf = () => window.Telegram?.WebApp?.HapticFeedback;

export function hapticImpact(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft' = 'light') {
  hf()?.impactOccurred(style);
}

export function hapticNotification(type: 'error' | 'success' | 'warning') {
  hf()?.notificationOccurred(type);
}

export function hapticSelection() {
  hf()?.selectionChanged();
}
