import { createPortal } from 'react-dom';

export function SuccessBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return createPortal(
    <div className="fixed top-0 left-0 right-0 z-[9999] p-3 animate-slide-down">
      <div className="bg-app-positive-bg text-app-positive p-3 rounded-xl text-sm flex justify-between items-start mx-auto max-w-lg shadow-lg">
        <span>{message}</span>
        {onDismiss && (
          <button onClick={onDismiss} className="ml-2 opacity-70 font-bold">
            &times;
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
