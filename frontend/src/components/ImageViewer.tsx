import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BottomSheet } from './BottomSheet';
import { ReportImage } from './ReportImage';
import { imageUrl } from '../utils/image';

interface ImageViewerProps {
  imageKey: string | null;
  open: boolean;
  onClose: () => void;
  alt?: string;
}

export function ImageViewer({ imageKey, open, onClose, alt = '' }: ImageViewerProps) {
  const { t } = useTranslation();
  const [reportKey, setReportKey] = useState<string | null>(null);

  function handleDownload() {
    if (!imageKey) return;
    const url = imageUrl(imageKey);
    window.Telegram?.WebApp?.openLink?.(url) ?? window.open(url, '_blank');
  }

  return (
    <>
      <BottomSheet open={open && !reportKey} onClose={onClose} title="">
        {imageKey && (
          <div>
            <img
              src={imageUrl(imageKey)}
              alt={alt}
              className="w-full rounded-xl"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
            <div className="flex items-center justify-between mt-3">
              <button
                onClick={() => setReportKey(imageKey)}
                className="p-2 rounded-lg text-tg-hint"
                aria-label={t('report.button')}
              >
                <svg
                  className="w-5 h-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </button>
              <button
                onClick={handleDownload}
                className="p-2 rounded-lg text-tg-link"
                aria-label={t('imageViewer.download')}
              >
                <svg
                  className="w-5 h-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </BottomSheet>

      <ReportImage
        imageKey={reportKey}
        open={!!reportKey}
        onClose={() => {
          setReportKey(null);
          onClose();
        }}
      />
    </>
  );
}
