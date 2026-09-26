// @jest-environment jsdom
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ForgeStudio from '../ForgeStudio';
import '@testing-library/jest-dom';
import { describe, test, expect, vi } from 'vitest';
vi.mock('../../../lib/store/editor-store', () => ({
  useEditorStore: () => ({
    viewMode: 'desktop',
    setViewMode: vi.fn(),
    blocks: [],
    addBlock: vi.fn(),
    setShowCode: vi.fn(),
    isPublishing: false,
    setIsPublishing: vi.fn(),
    lastPublishedUrl: null,
    setLastPublishedUrl: vi.fn(),
  }),
}));

// Mock fetch for publish
global.fetch = vi.fn(() =>
  Promise.resolve({ json: () => Promise.resolve({ success: true, url: 'http://localhost:8881/' }) })
) as any;

describe('ForgeStudio component', () => {
  test('renders header with title', () => {
    render(<ForgeStudio />);
    expect(screen.getByText('FORGE')).toBeInTheDocument();
  });

  test('toggles code view', () => {
    render(<ForgeStudio />);
    const button = screen.getByRole('button', { name: /Code/i });
fireEvent.click(button);
expect(button).toHaveTextContent(/Canvas/i);
  });

  test('publish button triggers API call and logging', async () => {
    render(<ForgeStudio />);
    const publishBtn = screen.getByRole('button', { name: /Publish/i });
fireEvent.click(publishBtn);
    await waitFor(() => expect(screen.getByText(/> Initiating Publish sequence.../i)).toBeInTheDocument());
  });

  test('shows loading state when publishing', async () => {
    let resolveFetch: any;
    (global.fetch as any).mockImplementationOnce(() => new Promise(r => { resolveFetch = r; }));
render(<ForgeStudio />);
const publishBtn = screen.getByRole('button', { name: /Publish/i });
    fireEvent.click(publishBtn);
    expect(publishBtn).toBeDisabled();
    resolveFetch({ json: () => ({ success: true, url: 'http://localhost:8881/' }) });
    await waitFor(() => expect(publishBtn).not.toBeDisabled());
  });

  test('displays live link after successful publish', async () => {
    render(<ForgeStudio />);
    const publishBtn = screen.getByRole('button', { name: /Publish/i });
    fireEvent.click(publishBtn);
    await waitFor(() => expect(screen.getByText(/LIVE/)).toBeInTheDocument());
  });
});
