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
