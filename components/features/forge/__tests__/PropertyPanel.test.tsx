import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { PropertyPanel } from '../PropertyPanel';
import '@testing-library/jest-dom';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import * as storeModule from '../../../../lib/store/editor-store';

// Mock the whole module
vi.mock('../../../../lib/store/editor-store', () => ({
  useEditorStore: vi.fn(),
}));

describe('PropertyPanel component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('renders empty state when no element selected', () => {
    (storeModule.useEditorStore as any).mockReturnValue({
      selectedId: null,
      findElement: vi.fn().mockReturnValue(null),
    });
    render(<PropertyPanel />);
    expect(screen.getByText('No Selection')).toBeInTheDocument();
  });

  test('renders properties for a text element', () => {
    const mockElement = {
      id: '1',
      type: 'text',
      className: 'text-red-500',
      content: 'Hello World',
      tag: 'h1'
    };
    (storeModule.useEditorStore as any).mockReturnValue({
      selectedId: '1',
      findElement: vi.fn().mockReturnValue(mockElement),
    });
    render(<PropertyPanel />);
    expect(screen.getByText('Inspector')).toBeInTheDocument();
    expect(screen.getByText('TEXT')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Hello World')).toBeInTheDocument();
    expect(screen.getByDisplayValue('text-red-500')).toBeInTheDocument();
  });

  test('updates class name on change', () => {
    const updateElement = vi.fn();
    const mockElement = {
      id: '1',
      type: 'text',
      className: 'old-class',
      content: 'text'
    };
    (storeModule.useEditorStore as any).mockReturnValue({
      selectedId: '1',
      findElement: vi.fn().mockReturnValue(mockElement),
      updateElement,
    });
    render(<PropertyPanel />);
    const textarea = screen.getByDisplayValue('old-class');
    fireEvent.change(textarea, { target: { value: 'new-class' } });
    expect(updateElement).toHaveBeenCalledWith('1', { className: 'new-class' });
  });

  test('updates tag on select change', () => {
    const updateElement = vi.fn();
    const mockElement = {
      id: '1',
      type: 'text',
      className: '',
      content: 'text',
      tag: 'h1'
    };
    (storeModule.useEditorStore as any).mockReturnValue({
      selectedId: '1',
      findElement: vi.fn().mockReturnValue(mockElement),
      updateElement,
    });
    render(<PropertyPanel />);
    const select = screen.getByDisplayValue('Heading 1');
    fireEvent.change(select, { target: { value: 'p' } });
    expect(updateElement).toHaveBeenCalledWith('1', { tag: 'p' });
  });

  test('renders section specific properties', () => {
    const mockSection = {
      id: 's1',
      type: 'section',
      className: 'bg-white',
      name: 'Hero Section'
    };
    (storeModule.useEditorStore as any).mockReturnValue({
      selectedId: 's1',
      findElement: vi.fn().mockReturnValue(mockSection),
    });
    render(<PropertyPanel />);
    expect(screen.getByText('SECTION')).toBeInTheDocument();
    expect(screen.getByDisplayValue('bg-white')).toBeInTheDocument();
  });
});
