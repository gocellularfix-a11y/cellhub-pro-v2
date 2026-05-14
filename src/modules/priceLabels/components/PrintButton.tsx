interface PrintButtonProps {
  disabled?: boolean;
  isPrinting?: boolean;
  copies: number;
  onClick: () => void;
}

export function PrintButton({ disabled, isPrinting, copies, onClick }: PrintButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || isPrinting}
      className={`w-full flex items-center justify-center gap-2 py-3 px-6 rounded-xl text-sm font-semibold transition-all shadow-sm ${
        disabled || isPrinting
          ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
          : 'bg-blue-600 text-white hover:bg-blue-700 active:scale-95'
      }`}
    >
      {isPrinting ? (
        <>
          <span className="animate-spin text-base">⟳</span>
          Preparing print…
        </>
      ) : (
        <>
          <span className="text-base">🖨</span>
          Print {copies} {copies === 1 ? 'copy' : 'copies'}
        </>
      )}
    </button>
  );
}
