import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { ErrorBoundary } from './components/ui/error-boundary';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary
      title="SOLARA could not start"
      description="The workspace failed to render. Reload the page or restart the development server; details are in the browser console."
    >
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

requestAnimationFrame(() => document.getElementById('boot-fallback')?.remove());
