// jest-dom adds custom vitest/jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement the ResizeObserver Web API. Every real browser has
// it, so this only matters for tests — but recharts' <ResponsiveContainer>
// requires it and throws "ResizeObserver is not defined" without this stub.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom also doesn't implement IntersectionObserver — DataReadiness.jsx's
// sticky section-navigator highlight uses it to track which section is
// scrolled into view. Without this stub, mounting that page in a test
// throws "IntersectionObserver is not defined" before any assertion runs.
if (typeof globalThis.IntersectionObserver === 'undefined') {
  globalThis.IntersectionObserver = class IntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom has no real 2D canvas backend (installing one requires the native
// `canvas` npm package, not present here) — calling getContext('2d') logs a
// noisy "not implemented" warning and returns undefined. Landing's
// ScrollVisual already guards against a falsy context and skips drawing, so
// this stub just makes that the clean, silent path under tests too, rather
// than a caught-but-logged jsdom warning on every test run.
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = () => null;
}
