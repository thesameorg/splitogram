/**
 * Sanitize a string to only allow valid decimal number input.
 * Allows digits, at most one decimal point, and optionally a leading comma as decimal separator.
 * Normalizes comma to dot for locales that use comma as decimal separator.
 */
export function sanitizeDecimalInput(value: string): string {
  // Replace comma with dot (common on European keyboards)
  let s = value.replace(',', '.');
  // Remove anything that's not a digit or dot
  s = s.replace(/[^\d.]/g, '');
  // Allow at most one dot
  const parts = s.split('.');
  if (parts.length > 2) {
    s = parts[0] + '.' + parts.slice(1).join('');
  }
  return s;
}
