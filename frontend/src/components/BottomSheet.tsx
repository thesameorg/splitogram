import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { hapticImpact } from '../utils/haptic';

export function BottomSheet({
  open,
  onClose,
  title,
  children,
  zIndex = 50,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  zIndex?: number;
}) {
  useEffect(() => {
    if (open) hapticImpact('light');
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end" style={{ zIndex }} onClick={onClose}>
      <div
        className="bg-tg-bg w-full rounded-t-2xl p-6 max-h-[85dvh] flex flex-col"
        style={{ paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold mb-4">{title}</h2>
        <div className="overflow-y-auto overflow-x-hidden flex-1 min-h-0">{children}</div>
      </div>
    </div>
  );
}
