import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../services/api';
import { BottomSheet } from './BottomSheet';

const REASONS = [
  { value: 'inappropriate', key: 'report.inappropriate' },
  { value: 'spam', key: 'report.spam' },
  { value: 'personal_info', key: 'report.personalInfo' },
  { value: 'copyright', key: 'report.copyright' },
  { value: 'other', key: 'report.other' },
] as const;

interface ReportImageProps {
  imageKey: string | null;
  open: boolean;
  onClose: () => void;
}

export function ReportImage({ imageKey, open, onClose }: ReportImageProps) {
  const { t } = useTranslation();
  const [reason, setReason] = useState<string>('');
  const [details, setDetails] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSend() {
    if (!reason || !imageKey || sending) return;
    setSending(true);
    try {
      await api.reportImage(imageKey, reason, details.trim() || undefined);
      setSent(true);
      setTimeout(() => {
        onClose();
        setSent(false);
        setReason('');
        setDetails('');
      }, 1500);
    } catch (e) {
      console.error('Failed to report image:', e);
    } finally {
      setSending(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={t('report.title')}>
      {sent ? (
        <div className="text-center py-6 text-app-positive font-medium">{t('report.sent')}</div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            {REASONS.map((r) => (
              <button
                key={r.value}
                onClick={() => setReason(r.value)}
                className={`w-full text-left p-3 rounded-xl border ${
                  reason === r.value ? 'border-tg-link bg-tg-button/10' : 'border-ghost card'
                }`}
              >
                <span className="text-sm font-medium">{t(r.key)}</span>
              </button>
            ))}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 text-tg-hint">
              {t('report.details')}
            </label>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder={t('report.detailsPlaceholder')}
              className="w-full p-3 border border-ghost rounded-xl bg-app-card-nested resize-none h-20 text-sm"
              maxLength={500}
            />
          </div>

          <button
            onClick={handleSend}
            disabled={!reason || sending}
            className="w-full bg-gradient-to-br from-[#92ccff] to-[#2b98dd] text-white py-3 rounded-xl font-semibold disabled:opacity-50"
          >
            {sending ? '...' : t('report.send')}
          </button>
        </div>
      )}
    </BottomSheet>
  );
}
