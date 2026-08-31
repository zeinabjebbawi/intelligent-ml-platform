import { render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import App from './App';
import { ThemeProvider } from './theme';

afterEach(() => {
  localStorage.clear();
});

// A returning user with a valid token skips Landing entirely and lands on
// Upload directly — see the lazy `stage` initializer in App.jsx.
test('renders the Upload page for an already-authenticated user, with the shared nav', () => {
  localStorage.setItem('access_token', 'fake-test-token');
  render(<ThemeProvider><App /></ThemeProvider>);
  expect(screen.getByText(/Data Ingestion/i)).toBeInTheDocument();
  expect(screen.getAllByText('PRISM').length).toBeGreaterThan(0);
});

// A first-time visitor with no token sees the Landing/auth gate instead —
// the canvas-based scroll hero (ScrollVisual/StoryOverlay) is inert under
// jsdom (no real canvas backend, IntersectionObserver stubbed as a no-op),
// so this only checks that AuthSection itself renders correctly.
test('renders the Landing page with Login/Register when no token exists', () => {
  localStorage.clear();
  const { container } = render(<ThemeProvider><App /></ThemeProvider>);
  expect(screen.getAllByText('Log In').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Create Account').length).toBeGreaterThan(0);
  expect(container.querySelector('canvas')).toBeInTheDocument();
});
