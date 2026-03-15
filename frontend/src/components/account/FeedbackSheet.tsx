import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { BottomSheet } from '../BottomSheet';

interface FeedbackSheetProps {
  open: boolean;
  onClose: () => void;
  feedbackText: string;
  feedbackFiles: File[];
  sendingFeedback: boolean;
  feedbackFileInputRef: RefObject<HTMLInputElement | null>;
  onTextChange: (text: string) => void;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveFile: (index: number) => void;
  onSend: () => void;
}

export function FeedbackSheet({
  open,
  onClose,
  feedbackText,
  feedbackFiles,
  sendingFeedback,
  feedbackFileInputRef,
  onTextChange,
  onFileSelect,
  onRemoveFile,
  onSend,
}: FeedbackSheetProps) {
  const { t } = useTranslation();

  return (
    <BottomSheet open={open} onClose={onClose} title={t('account.feedback')}>
      <div className="space-y-4">
        <textarea
          value={feedbackText}
          onChange={(e) => onTextChange(e.target.value)}
          placeholder={t('account.feedbackPlaceholder')}
          className="w-full p-3 border border-tg-separator rounded-xl bg-transparent resize-none h-32"
          maxLength={2000}
        />

        {/* Attachments */}
        {feedbackFiles.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {feedbackFiles.map((file, i) => (
              <div
                key={i}
                className="flex items-center gap-1.5 px-2 py-1 bg-tg-section rounded-lg border border-tg-separator text-xs"
              >
                <span className="truncate max-w-[120px]">{file.name}</span>
                <button
                  onClick={() => onRemoveFile(i)}
                  className="text-tg-destructive font-bold"
                  aria-label={`Remove ${file.name}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          {feedbackFiles.length < 5 && (
            <button
              onClick={() => feedbackFileInputRef.current?.click()}
              className="px-4 py-3 border border-dashed border-tg-separator rounded-xl text-sm text-tg-hint"
              aria-label="Attach file"
            >
              📎
            </button>
          )}
          <button
            onClick={onSend}
            disabled={sendingFeedback || !feedbackText.trim()}
            className="flex-1 bg-tg-button text-tg-button-text py-3 rounded-xl font-medium disabled:opacity-50"
          >
            {sendingFeedback ? '...' : t('account.feedbackSend')}
          </button>
        </div>
        <input
          ref={feedbackFileInputRef}
          type="file"
          multiple
          accept="image/*,application/pdf,.doc,.docx,.txt"
          onChange={onFileSelect}
          className="hidden"
          aria-label="Attach file"
        />
      </div>
    </BottomSheet>
  );
}
