import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import App from './App';
import { ThemeProvider } from './theme';

// App's journey now starts on the Upload page (not the dev-harness CSV-path
// loader, which only appears once you reach the Cleaning step with no
// dataset yet) — see the `stage` state in App.jsx.
test('renders the Upload page by default, with the shared nav', () => {
  render(<ThemeProvider><App /></ThemeProvider>);
  expect(screen.getByText(/Data Ingestion/i)).toBeInTheDocument();
  expect(screen.getAllByText('PRISM').length).toBeGreaterThan(0);
});
