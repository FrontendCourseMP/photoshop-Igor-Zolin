import { render, screen } from '@testing-library/react';
import App from './App';

test('renders upload and save controls with canvas', () => {
  render(<App />);

  expect(screen.getAllByText(/upload image/i).length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: /save image/i })).toBeInTheDocument();
  expect(document.getElementById('myCanvas')).toBeInTheDocument();
});
