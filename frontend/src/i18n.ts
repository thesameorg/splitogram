import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import ru from './locales/ru.json';
import es from './locales/es.json';
import hi from './locales/hi.json';
import id from './locales/id.json';
import fa from './locales/fa.json';
import pt from './locales/pt.json';
import uk from './locales/uk.json';
import de from './locales/de.json';
import it from './locales/it.json';
import vi from './locales/vi.json';

const SUPPORTED_LANGS = ['en', 'ru', 'es', 'hi', 'id', 'fa', 'pt', 'uk', 'de', 'it', 'vi'] as const;

// True once CloudStorage returns a saved preference (user explicitly chose a language before)
export let hasPersistedLocale = false;

function detectLanguage(): string {
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
    hi: { translation: hi },
    id: { translation: id },
    fa: { translation: fa },
    pt: { translation: pt },
    uk: { translation: uk },
    de: { translation: de },
    it: { translation: it },
    vi: { translation: vi },
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
    if (value && SUPPORTED_LANGS.includes(value as any)) {
      hasPersistedLocale = true;
      if (value !== i18n.language) {
        i18n.changeLanguage(value);
      }
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
