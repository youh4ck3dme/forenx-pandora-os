// @jest-environment jsdom
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ForgeStudio from '../ForgeStudio';
import '@testing-library/jest-dom';
import { describe, test, expect, vi } from 'vitest';

// Mock editor store with state that can be toggled
let storeState = {
  viewMode: 'desktop',
  showCode: false,
  blocks: [],
  isPublishing: false,
  lastPublishedUrl: null,
};

vi.mock('../../../lib/store/editor-store', () => ({
  useEditorStore: () => ({
    viewMode: storeState.viewMode,
    setViewMode: vi.fn((mode) => { storeState.viewMode = mode; }),
    blocks: storeState.blocks,
    addBlock: vi.fn((block) => { storeState.blocks.push(block); }),
    showCode: storeState.showCode,
    setShowCode: vi.fn((value: boolean) => { storeState.showCode = value; }),
    isPublishing: storeState.isPublishing,
    setIsPublishing: vi.fn((value: boolean) => { storeState.isPublishing = value; }),
    lastPublishedUrl: storeState.lastPublishedUrl,
    setLastPublishedUrl: vi.fn((url: string | null) => { storeState.lastPublishedUrl = url; }),
  }),
}));

// Mock fetch for publish
global.fetch = vi.fn(() =>
  Promise.resolve({ json: () => Promise.resolve({ success: true, url: 'http://localhost:8881/' }) })
) as any;

describe('ForgeStudio component', () => {
  beforeEach(() => {
    // Reset store state before each test
    storeState = {
      viewMode: 'desktop',
      showCode: false,
      blocks: [],
      isPublishing: false,
      lastPublishedUrl: null,
    };
  });

  test('renders header with title', () => {
    render(<ForgeStudio />);
    expect(screen.getByText('FORGE')).toBeInTheDocument();
  });

  test('toggles code view', async () => {
    render(<ForgeStudio />);
    const button = screen.getByRole('button', { name: /Code/i });
    fireEvent.click(button);
    await waitFor(() => {
      expect(button).toHaveTextContent(/Canvas/i);
    });
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
