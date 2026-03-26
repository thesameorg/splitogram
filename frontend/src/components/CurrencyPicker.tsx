import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BottomSheet } from './BottomSheet';
import { searchCurrencies, getCurrency } from '../utils/currencies';

export function CurrencyPicker({
  open,
  onClose,
  value,
  onSelect,
  zIndex = 50,
}: {
  open: boolean;
  onClose: () => void;
  value: string;
  onSelect: (code: string) => void;
  zIndex?: number;
}) {
  const [query, setQuery] = useState('');
  const { t } = useTranslation();
  const results = searchCurrencies(query);

  function handleSelect(code: string) {
    onSelect(code);
    setQuery('');
    onClose();
  }

  function handleClose() {
    setQuery('');
    onClose();
  }

  return (
    <BottomSheet
      open={open}
      onClose={handleClose}
      title={t('currencyPicker.title')}
      zIndex={zIndex}
    >
      <input
        type="text"
        placeholder={t('currencyPicker.search')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full p-3 border border-ghost rounded-xl mb-3 bg-app-card-nested"
        autoFocus
        aria-label={t('currencyPicker.search')}
      />
      <div className="overflow-y-auto -mx-2">
        {results.length === 0 ? (
          <p className="text-center text-tg-hint py-4">{t('currencyPicker.noResults')}</p>
        ) : (
          results.map((c) => {
            const isSelected = c.code === value;
            return (
              <button
                key={c.code}
                onClick={() => handleSelect(c.code)}
                className={`w-full text-left px-4 py-3 flex items-center justify-between rounded-lg ${
                  isSelected ? 'bg-tg-secondary-bg text-tg-link' : ''
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="w-8 text-center text-lg">{c.symbol}</span>
                  <div>
                    <div className="font-medium">{c.name}</div>
                    <div className="text-xs text-tg-hint">{c.code}</div>
                  </div>
                </div>
                {isSelected && <span className="text-tg-link text-lg">&#10003;</span>}
              </button>
            );
          })
        )}
      </div>
    </BottomSheet>
  );
}

export function CurrencyButton({
  value,
  onClick,
  disabled,
}: {
  value: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  const currency = getCurrency(value);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full p-3 border border-ghost rounded-xl bg-app-card-nested text-left flex items-center justify-between disabled:opacity-50"
    >
      <span>
        {currency.symbol} {currency.name} ({currency.code})
      </span>
      <span className="text-tg-hint">&#9662;</span>
    </button>
  );
}
