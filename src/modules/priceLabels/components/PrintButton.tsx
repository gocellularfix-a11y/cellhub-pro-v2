interface PrintButtonProps {
  disabled?: boolean;
  isPrinting?: boolean;
  copies: number;
  onClick: () => void;
}

export function PrintButton({ disabled, isPrinting, copies, onClick }: PrintButtonProps) {
  const isDisabled = disabled || isPrinting;

  return (
    <button
      onClick={onClick}
      disabled={isDisabled}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.5rem',
        padding: '0.75rem 1.5rem',
        borderRadius: '12px',
        fontSize: '0.875rem',
        fontWeight: 600,
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        transition: 'all 0.15s ease',
        border: 'none',
        ...(isDisabled
          ? {
              background: '#141e30',
              color: '#334155',
              boxShadow: 'none',
            }
          : {
              background: 'linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%)',
              color: '#ffffff',
              boxShadow: '0 0 20px rgba(56,189,248,0.25), 0 4px 12px rgba(0,0,0,0.3)',
            }),
      }}
    >
      {isPrinting ? (
        <>
          <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite', fontSize: '1rem' }}>⟳</span>
          Preparing print…
        </>
      ) : (
        <>
          <span style={{ fontSize: '1rem' }}>🖨</span>
          Print {copies} {copies === 1 ? 'copy' : 'copies'}
        </>
      )}
    </button>
  );
}
