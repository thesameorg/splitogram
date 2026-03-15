import { useState } from 'react';
import i18n from '../i18n';
import { hapticImpact } from '../utils/haptic';

const LANGUAGES = [
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

// Hardcoded per-language title (no i18n dependency — shown before language is chosen)
const TITLES: Record<string, string> = {
  en: 'Choose your language',
  ru: 'Выберите язык',
  es: 'Elige tu idioma',
  hi: 'अपनी भाषा चुनें',
  id: 'Pilih bahasa Anda',
  fa: 'زبان خود را انتخاب کنید',
  pt: 'Escolha seu idioma',
  uk: 'Оберіть мову',
  de: 'Wähle deine Sprache',
  it: 'Scegli la tua lingua',
  vi: 'Chọn ngôn ngữ của bạn',
};

export function LanguagePickerModal({ onDone }: { onDone: () => void }) {
  const [selected, setSelected] = useState(i18n.language);

  function handleSelect(code: string) {
    hapticImpact('light');
    setSelected(code);
  }

  function handleConfirm() {
    hapticImpact('medium');
    if (selected !== i18n.language) {
      i18n.changeLanguage(selected);
    }
    // Persist to CloudStorage (i18n.on('languageChanged') handler does this,
    // but if language didn't change we still want to mark it as explicitly chosen)
    try {
      window.Telegram?.WebApp?.CloudStorage?.setItem('lang', selected);
    } catch {
      // CloudStorage not available
    }
    onDone();
  }

  const title = TITLES[selected] || TITLES.en;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] px-4">
      <div
        className="bg-tg-bg w-full max-w-sm rounded-2xl overflow-hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="p-5 pb-3">
          <h2 className="text-lg font-bold text-center">{title}</h2>
        </div>

        <div className="overflow-y-auto max-h-[60dvh] px-3">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              onClick={() => handleSelect(lang.code)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-colors ${
                selected === lang.code ? 'bg-tg-button/10' : ''
              }`}
            >
              <span className="text-xl">{lang.flag}</span>
              <span className="font-medium flex-1 text-tg-text">{lang.name}</span>
              {selected === lang.code && (
                <span className="text-tg-link font-bold">&#10003;</span>
              )}
            </button>
          ))}
        </div>

        <div className="p-4 pt-3">
          <button
            onClick={handleConfirm}
            className="w-full py-3 rounded-xl font-semibold bg-tg-button text-tg-button-text"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
