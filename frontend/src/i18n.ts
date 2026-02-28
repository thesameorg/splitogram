import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import ru from './locales/ru.json';
import es from './locales/es.json';

const SUPPORTED_LANGS = ['en', 'ru', 'es'] as const;

function detectLanguage(): string {
  // 1. Check Telegram CloudStorage (async — will be applied later if found)
  // 2. Detect from Telegram user language
  const tgLang = window.Telegram?.WebApp?.initDataUnsafe?.user?.language_code;
  if (tgLang && SUPPORTED_LANGS.includes(tgLang as any)) {
    return tgLang;
  }
  return 'en';
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ru: { translation: ru },
    es: { translation: es },
  },
  lng: detectLanguage(),
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
  saveMissing: import.meta.env.DEV,
  missingKeyHandler: import.meta.env.DEV
    ? (_lngs, _ns, key) => {
        console.warn(`[i18n] Missing key: ${key}`);
      }
    : undefined,
});

// Async: try CloudStorage for persisted language preference
try {
  window.Telegram?.WebApp?.CloudStorage?.getItem('lang', (_err: any, value: string | null) => {
    if (value && SUPPORTED_LANGS.includes(value as any) && value !== i18n.language) {
      i18n.changeLanguage(value);
    }
  });
} catch {
  // CloudStorage not available
}

// Persist language changes to CloudStorage
i18n.on('languageChanged', (lng) => {
  try {
    window.Telegram?.WebApp?.CloudStorage?.setItem('lang', lng);
  } catch {
    // CloudStorage not available
  }
});

export default i18n;
