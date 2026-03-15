export const LANGUAGES = [
  { code: 'en', flag: '\u{1F1EC}\u{1F1E7}', name: 'English' },
  { code: 'ru', flag: '\u{1F1F7}\u{1F1FA}', name: 'Русский' },
  { code: 'es', flag: '\u{1F1EA}\u{1F1F8}', name: 'Español' },
  { code: 'hi', flag: '\u{1F1EE}\u{1F1F3}', name: 'हिन्दी' },
  { code: 'id', flag: '\u{1F1EE}\u{1F1E9}', name: 'Bahasa Indonesia' },
  { code: 'fa', flag: '\u{1F1EE}\u{1F1F7}', name: 'فارسی' },
  { code: 'pt', flag: '\u{1F1E7}\u{1F1F7}', name: 'Português' },
  { code: 'uk', flag: '\u{1F1FA}\u{1F1E6}', name: 'Українська' },
  { code: 'de', flag: '\u{1F1E9}\u{1F1EA}', name: 'Deutsch' },
  { code: 'it', flag: '\u{1F1EE}\u{1F1F9}', name: 'Italiano' },
  { code: 'vi', flag: '\u{1F1FB}\u{1F1F3}', name: 'Tiếng Việt' },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]['code'];
