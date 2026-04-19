import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider } from '@/store/AppProvider';
import { MultiStoreProvider } from '@/store/MultiStoreProvider';
import { ToastProvider } from '@/components/ui/Toast';
import ErrorBoundary from '@/components/shared/ErrorBoundary';
import LicenseGate from '@/components/shared/LicenseGate';
import App from './App';
import '@/styles/index.css';

// Prevent accidental value changes when cashier scrolls the page over a
// focused number input. POS = critical, no money changes from mouse wheel.
document.addEventListener('wheel', (e) => {
  const el = e.target as HTMLElement;
  if (el && el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'number' && el === document.activeElement) {
    (el as HTMLInputElement).blur();
  }
}, { passive: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <LicenseGate>
        <AppProvider>
          <MultiStoreProvider>
            <ToastProvider>
              <App />
            </ToastProvider>
          </MultiStoreProvider>
        </AppProvider>
      </LicenseGate>
    </ErrorBoundary>
  </StrictMode>,
);
