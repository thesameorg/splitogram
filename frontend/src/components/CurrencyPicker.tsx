import { useState } from 'react';
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
    <BottomSheet open={open} onClose={handleClose} title="Select Currency" zIndex={zIndex}>
      <input
        type="text"
        placeholder="Search currencies..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full p-3 border border-gray-200 dark:border-gray-600 rounded-xl mb-3 bg-transparent"
        autoFocus
      />
      <div className="max-h-[50vh] overflow-y-auto -mx-2">
        {results.length === 0 ? (
          <p className="text-center text-gray-500 py-4">No currencies found</p>
        ) : (
          results.map((c) => {
            const isSelected = c.code === value;
            return (
              <button
                key={c.code}
                onClick={() => handleSelect(c.code)}
                className={`w-full text-left px-4 py-3 flex items-center justify-between rounded-lg ${
                  isSelected
                    ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="w-8 text-center text-lg">{c.symbol}</span>
                  <div>
                    <div className="font-medium">{c.name}</div>
                    <div className="text-xs text-gray-500">{c.code}</div>
                  </div>
                </div>
                {isSelected && <span className="text-blue-500 text-lg">&#10003;</span>}
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
      className="w-full p-3 border border-gray-200 dark:border-gray-600 rounded-xl bg-transparent text-left flex items-center justify-between disabled:opacity-50"
    >
      <span>
        {currency.symbol} {currency.name} ({currency.code})
      </span>
      <span className="text-gray-400">&#9662;</span>
    </button>
  );
}
