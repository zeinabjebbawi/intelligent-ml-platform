import { render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import App from './App';
import { ThemeProvider } from './theme';

afterEach(() => {
  localStorage.clear();
});

// A returning user with a valid token skips Landing entirely and lands on
// Workspace directly — see the lazy `stage` initializer in App.jsx. Django
// isn't running in this test, so Workspace's own project-list fetch fails
// and surfaces its own inline error — that's fine, it doesn't block the
// page itself from rendering.
test('renders the Workspace page for an already-authenticated user', async () => {
  localStorage.setItem('access_token', 'fake-test-token');
  render(<ThemeProvider><App /></ThemeProvider>);
  expect(await screen.findByText(/New Project/)).toBeInTheDocument();
  expect(screen.getAllByText('PRISM').length).toBeGreaterThan(0);
});

// A first-time visitor with no token sees the Landing/auth gate instead —
// the WebGL crystal scene (CrystalScene) is inert under jsdom (no real
// canvas/WebGL backend, IntersectionObserver stubbed as a no-op so its
// scroll-progress loop never even starts), so this only checks that
// AuthSection itself renders correctly.
test('renders the Landing page with Sign in/Create account when no token exists', () => {
  localStorage.clear();
  render(<ThemeProvider><App /></ThemeProvider>);
  expect(screen.getByText('Sign in')).toBeInTheDocument();
  expect(screen.getByText('Create account')).toBeInTheDocument();
});
