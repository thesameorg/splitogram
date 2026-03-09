import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Uncaught error:', error, info.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-screen p-6 text-center bg-tg-bg text-tg-text">
          <div>
            <h1 className="text-xl font-bold mb-2">Something went wrong</h1>
            <p className="text-tg-hint mb-4">The app encountered an unexpected error.</p>
            <button
              onClick={this.handleReload}
              className="px-4 py-2 rounded-lg bg-tg-button text-tg-button-text font-medium"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
