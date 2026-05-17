import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

// Reads lang from localStorage without requiring React hooks (class component).
function getI18n(): { title: string; body: string; reload: string } {
  try {
    const s = JSON.parse(localStorage.getItem('settings') || '{}') as { lang?: string };
    if (s.lang === 'es') return {
      title: 'CellHub Pro encontró un error',
      body: 'Algo salió mal. Por favor recarga la aplicación.',
      reload: 'Recargar aplicación',
    };
    if (s.lang === 'pt') return {
      title: 'CellHub Pro encontrou um erro',
      body: 'Algo deu errado. Por favor, recarregue o aplicativo.',
      reload: 'Recarregar aplicativo',
    };
  } catch { /* localStorage unavailable */ }
  return {
    title: 'CellHub Pro encountered an error',
    body: 'Something went wrong. Please reload the app.',
    reload: 'Reload App',
  };
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('🔴 CellHub Pro crashed:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      const i18n = getI18n();
      return (
        <div className="min-h-screen flex items-center justify-center bg-surface-900 p-8">
          <div className="glass-card p-8 max-w-md text-center">
            <div className="text-4xl mb-4">⚠️</div>
            <h1 className="text-xl font-bold text-white mb-2">
              {i18n.title}
            </h1>
            <p className="text-slate-400 text-sm mb-4">
              {i18n.body}
            </p>
            <button
              className="btn btn-primary"
              onClick={() => {
                this.setState({ hasError: false });
                window.location.reload();
              }}
            >
              {i18n.reload}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
