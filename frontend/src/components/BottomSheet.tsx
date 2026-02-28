import type { ReactNode } from 'react';

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
  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end" style={{ zIndex }} onClick={onClose}>
      <div
        className="bg-tg-bg w-full rounded-t-2xl p-6 max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold mb-4">{title}</h2>
        {children}
      </div>
    </div>
  );
}
