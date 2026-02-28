export function SuccessBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return (
    <div className="bg-app-positive-bg text-app-positive p-3 rounded-xl mb-4 text-sm flex justify-between items-start">
      <span>{message}</span>
      {onDismiss && (
        <button onClick={onDismiss} className="ml-2 opacity-70 font-bold">
          &times;
        </button>
      )}
    </div>
  );
}
