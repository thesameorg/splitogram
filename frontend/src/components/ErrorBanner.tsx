export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return (
    <div className="bg-red-50 text-red-600 p-3 rounded-xl mb-4 text-sm flex justify-between items-start">
      <span>{message}</span>
      {onDismiss && (
        <button onClick={onDismiss} className="ml-2 text-red-400 font-bold">
          &times;
        </button>
      )}
    </div>
  );
}
