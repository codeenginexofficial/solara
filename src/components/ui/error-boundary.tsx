import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from './button';

interface ErrorBoundaryProps {
  children: ReactNode;
  title: string;
  description: string;
  resetLabel?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`${this.props.title}: ${error.message}`, info.componentStack);
  }

  private reset = () => {
    this.setState({ error: null });
  };

  override render() {
    if (this.state.error) {
      return (
        <div className="flex h-full w-full items-center justify-center bg-surface px-5">
          <section
            className="max-w-lg rounded-lg border border-edge bg-panel p-5 text-center"
            role="alert"
          >
            <h2 className="text-sm font-semibold text-ink">{this.props.title}</h2>
            <p className="mt-2 text-xs leading-5 text-ink-muted">{this.props.description}</p>
            <Button className="mt-4" variant="outline" size="sm" onClick={this.reset}>
              {this.props.resetLabel ?? 'Retry'}
            </Button>
          </section>
        </div>
      );
    }

    return this.props.children;
  }
}
