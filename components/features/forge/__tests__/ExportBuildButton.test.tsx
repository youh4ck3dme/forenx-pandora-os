import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ExportBuildButton } from '../ExportBuildButton';
import '@testing-library/jest-dom';
import { describe, test, expect, vi, beforeEach } from 'vitest';

describe('ExportBuildButton component', () => {
  const mockAddLog = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  test('renders the button', () => {
    render(<ExportBuildButton addLog={mockAddLog} />);
    expect(screen.getByText('Export & Build')).toBeInTheDocument();
  });

  test('shows loading state on click', async () => {
    (global.fetch as any).mockImplementation(() =>
      new Promise(resolve => setTimeout(() => resolve({ ok: true, json: () => Promise.resolve({}) }), 100))
    );

    render(<ExportBuildButton addLog={mockAddLog} />);
    fireEvent.click(screen.getByText('Export & Build'));

    expect(screen.getByText('Packaging...')).toBeInTheDocument();
    expect(mockAddLog).toHaveBeenCalledWith('> Initiating Export & Build sequence...');
  });

  test('handles successful export', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ message: 'Build complete' }),
    });

    render(<ExportBuildButton addLog={mockAddLog} />);
    fireEvent.click(screen.getByText('Export & Build'));

    await waitFor(() => {
      expect(mockAddLog).toHaveBeenCalledWith('> ✅ Success: Build complete');
    });
  });

  test('handles fetch error', async () => {
    (global.fetch as any).mockRejectedValue(new Error('Network Fail'));

    render(<ExportBuildButton addLog={mockAddLog} />);
    fireEvent.click(screen.getByText('Export & Build'));

    await waitFor(() => {
      expect(mockAddLog).toHaveBeenCalledWith('> ❌ Export failed: Network Fail');
    });
  });

  test('handles API error response', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Disk full' }),
    });

    render(<ExportBuildButton addLog={mockAddLog} />);
    fireEvent.click(screen.getByText('Export & Build'));

    await waitFor(() => {
      expect(mockAddLog).toHaveBeenCalledWith('> ❌ Export failed: Disk full');
    });
  });
});
