import type { ReactNode } from 'react';

export function BottomSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end z-50" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 w-full rounded-t-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold mb-4">{title}</h2>
        {children}
      </div>
    </div>
  );
}
