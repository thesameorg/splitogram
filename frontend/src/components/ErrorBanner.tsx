export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return (
    <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-3 rounded-xl mb-4 text-sm flex justify-between items-start">
      <span>{message}</span>
      {onDismiss && (
        <button onClick={onDismiss} className="ml-2 text-red-400 dark:text-red-500 font-bold">
          &times;
        </button>
      )}
    </div>
  );
}
