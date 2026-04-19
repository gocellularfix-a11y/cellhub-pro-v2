import { type ReactNode } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  /** Max width class. Default: 'max-w-lg' */
  size?: 'max-w-sm' | 'max-w-md' | 'max-w-lg' | 'max-w-xl' | 'max-w-2xl' | 'max-w-4xl' | 'max-w-6xl';
  /** Show close (X) button. Default: true */
  showClose?: boolean;
  /** Footer content (buttons) */
  footer?: ReactNode;
}

export default function Modal({
  open,
  onClose,
  title,
  children,
  size = 'max-w-lg',
  showClose = true,
  footer,
}: ModalProps) {
  if (!open) return null;

  return (
    // No onClick on overlay — only X button closes
    <div className="modal-overlay">
      <div className={`modal-content w-full ${size} mx-4`}>
        {/* Header */}
        {(title || showClose) && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
            {title && (
              <h2 className="text-lg font-semibold text-white">{title}</h2>
            )}
            {showClose && (
              <button
                onClick={onClose}
                className="text-slate-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/10"
                aria-label="Close"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        )}

        {/* Body */}
        <div className="px-6 py-4">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/10">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
