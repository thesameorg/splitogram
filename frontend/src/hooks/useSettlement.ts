import { useState, useEffect } from 'react';
import { api, type SettlementDetail } from '../services/api';
import { getCurrency } from '../utils/currencies';

export function useSettlement(settlementId: number) {
  const [settlement, setSettlement] = useState<SettlementDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [amountStr, setAmountStr] = useState('');

  useEffect(() => {
    if (isNaN(settlementId)) return;
    api
      .getSettlement(settlementId)
      .then((data) => {
        setSettlement(data);
        const currency = getCurrency(data.currency);
        const display = data.amount / 1_000_000;
        setAmountStr(
          currency.decimals === 0
            ? String(Math.round(display))
            : display.toFixed(currency.decimals),
        );
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [settlementId]);

  return { settlement, setSettlement, loading, error, setError, amountStr, setAmountStr };
}
