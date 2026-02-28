export function SuccessBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return (
    <div className="bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 p-3 rounded-xl mb-4 text-sm flex justify-between items-start">
      <span>{message}</span>
      {onDismiss && (
        <button onClick={onDismiss} className="ml-2 text-green-400 dark:text-green-500 font-bold">
          &times;
        </button>
      )}
    </div>
  );
}
