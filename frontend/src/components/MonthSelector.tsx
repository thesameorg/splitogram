import { useTranslation } from 'react-i18next';

interface MonthSelectorProps {
  availableMonths: string[];
  selected: string;
  onChange: (period: string) => void;
}

function formatMonth(yyyyMm: string, locale: string): string {
  const [year, month] = yyyyMm.split('-').map(Number);
  const date = new Date(year, month - 1, 1);
  return date.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
}

export function MonthSelector({ availableMonths, selected, onChange }: MonthSelectorProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || 'en';

  // Current position in availableMonths
  const currentIndex = selected === 'all' ? -1 : availableMonths.indexOf(selected);

  const canGoNewer = selected !== 'all' && currentIndex > 0;
  const canGoOlder =
    selected === 'all' ? availableMonths.length > 0 : currentIndex < availableMonths.length - 1;

  function goNewer() {
    if (canGoNewer) {
      onChange(availableMonths[currentIndex - 1]);
    }
  }

  function goOlder() {
    if (selected === 'all' && availableMonths.length > 0) {
      onChange(availableMonths[0]);
    } else if (canGoOlder) {
      onChange(availableMonths[currentIndex + 1]);
    }
  }

  return (
    <div className="flex items-center justify-between gap-2 py-3">
      <button
        onClick={() => onChange('all')}
        className={`px-3 py-1.5 rounded-full text-sm font-medium shrink-0 ${
          selected !== 'all'
            ? 'bg-tg-button text-tg-button-text'
            : 'bg-tg-section text-tg-hint border border-tg-separator'
        }`}
      >
        {t('group.statsAllTime')}
      </button>

      <div className="flex items-center gap-2">
        <button
          onClick={goNewer}
          disabled={!canGoNewer}
          className={`text-lg px-2 ${canGoNewer ? 'text-tg-link' : 'text-tg-separator'}`}
          aria-label="Previous month"
        >
          &lsaquo;
        </button>
        <span className="text-sm font-medium min-w-[120px] text-center">
          {selected === 'all' ? '—' : formatMonth(selected, locale)}
        </span>
        <button
          onClick={goOlder}
          disabled={!canGoOlder}
          className={`text-lg px-2 ${canGoOlder ? 'text-tg-link' : 'text-tg-separator'}`}
          aria-label="Next month"
        >
          &rsaquo;
        </button>
      </div>
    </div>
  );
}
