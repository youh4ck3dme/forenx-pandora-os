import React from 'react';
import { render, screen } from '@testing-library/react';
import { VisualCanvas } from '../VisualCanvas';
import '@testing-library/jest-dom';
import { describe, test, expect, vi } from 'vitest';
import * as storeModule from '../../../../lib/store/editor-store';

// Mock the whole module
vi.mock('../../../../lib/store/editor-store', () => ({
  useEditorStore: vi.fn(),
}));

// Mock dnd-kit
vi.mock('@dnd-kit/core', () => ({
  useDroppable: () => ({ isOver: false, setNodeRef: vi.fn() }),
  useDraggable: () => ({ attributes: {}, listeners: {}, setNodeRef: vi.fn(), transform: null }),
  DragOverlay: ({ children }: any) => <div>{children}</div>,
  DndContext: ({ children }: any) => <div>{children}</div>,
}));

describe('VisualCanvas component', () => {
  test('renders the drop zone', () => {
    (storeModule.useEditorStore as any).mockReturnValue({
      blocks: [],
      selectedId: null,
      setSelectedId: vi.fn(),
    });
    render(<VisualCanvas />);
    expect(screen.getByTestId('canvas-drop-zone')).toBeInTheDocument();
  });

  test('renders blocks from store', () => {
    (storeModule.useEditorStore as any).mockReturnValue({
      blocks: [
        {
          id: '1',
          type: 'section',
          name: 'Hero Section',
          className: 'bg-custom-blue',
          children: [
            { id: '2', type: 'text', tag: 'h1', content: 'Test Heading', className: 'text-white' }
          ]
        }
      ],
      selectedId: null,
      setSelectedId: vi.fn(),
    });
    render(<VisualCanvas />);
    expect(screen.getByText('Test Heading')).toBeInTheDocument();
  });

  test('applies section class names', () => {
    (storeModule.useEditorStore as any).mockReturnValue({
      blocks: [
        {
          id: '1',
          type: 'section',
          name: 'Hero',
          className: 'bg-custom-blue',
          children: []
        }
      ],
      selectedId: null,
      setSelectedId: vi.fn(),
    });
    render(<VisualCanvas />);
    // Select the section so the Hero label appears
    const section = screen.getByTestId('canvas-drop-zone').querySelector('section');
    expect(section).toHaveClass('bg-custom-blue');
  });

  test('renders HTML tags correctly', () => {
    (storeModule.useEditorStore as any).mockReturnValue({
      blocks: [
        {
          id: '1',
          type: 'section',
          name: 'Hero',
          children: [
            { id: '2', type: 'text', tag: 'h1', content: 'Heading 1', className: '' }
          ]
        }
      ],
      selectedId: null,
      setSelectedId: vi.fn(),
    });
    render(<VisualCanvas />);
    const h1 = screen.getByText('Heading 1');
    expect(h1.tagName).toBe('H1');
  });

  test('shows empty state when no blocks', () => {
    (storeModule.useEditorStore as any).mockReturnValue({
      blocks: [],
      selectedId: null,
      setSelectedId: vi.fn(),
    });

    render(<VisualCanvas />);
    expect(screen.getByText('Build Your Vision')).toBeInTheDocument();
    expect(screen.getByText(/Drag elements from the sidebar/i)).toBeInTheDocument();
  });
});
