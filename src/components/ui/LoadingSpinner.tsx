interface LoadingSpinnerProps {
  /** Full-screen loading overlay. Default: false */
  fullscreen?: boolean;
  message?: string;
}

export default function LoadingSpinner({
  fullscreen = false,
  message = 'Loading CellHub Pro…',
}: LoadingSpinnerProps) {
  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-surface-900">
        <div className="spinner mb-4" />
        <p className="text-sm text-slate-400">{message}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-12">
      <div className="spinner mb-3" />
      {message && <p className="text-sm text-slate-400">{message}</p>}
    </div>
  );
}
