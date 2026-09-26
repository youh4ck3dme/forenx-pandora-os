// @jest-environment jsdom
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ElementsSidebar } from '../ElementsSidebar';
import '@testing-library/jest-dom';
import { describe, test, expect, vi } from 'vitest';
import '@testing-library/jest-dom';

// Mock editor store (no drag functionality needed for rendering)
vi.mock('../../../lib/store/editor-store', () => ({
  useEditorStore: () => ({})
}));

describe('ElementsSidebar component', () => {
  test('renders header with title', () => {
    render(<ElementsSidebar />);
    expect(screen.getByText('ELEMENTS')).toBeInTheDocument();
  });

  test('renders section block item', () => {
    render(<ElementsSidebar />);
    expect(screen.getByText('Section Block')).toBeInTheDocument();
  });

  test('renders container block item', () => {
    render(<ElementsSidebar />);
    expect(screen.getByText('Container')).toBeInTheDocument();
  });

  test('renders text block item', () => {
    render(<ElementsSidebar />);
    expect(screen.getByText('Text Block')).toBeInTheDocument();
  });

  test('renders image block item', () => {
    render(<ElementsSidebar />);
    expect(screen.getByText('Image')).toBeInTheDocument();
  });
});
