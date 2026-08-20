import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import App from './App';

test('renders the dataset path loader form by default', () => {
  render(<App />);
  expect(screen.getByPlaceholderText(/my_dataset\.csv/i)).toBeInTheDocument();
  expect(screen.getByText(/Load Dataset/i)).toBeInTheDocument();
});
