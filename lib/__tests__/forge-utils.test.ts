import { describe, it, expect } from 'vitest'
import { generateReactCode } from '../forge'
import { SectionBlock } from '../store/editor-store'

describe('forge-utils', () => {
  describe('generateReactCode', () => {
    it('should generate a basic react component structure', () => {
      const blocks: SectionBlock[] = []
      const code = generateReactCode(blocks)

      expect(code).toContain('import React from \'react\'')
      expect(code).toContain('export default function App()')
      expect(code).toContain('<div className="min-h-screen')
    })

    it('should render a section with text element', () => {
      const blocks: SectionBlock[] = [
        {
          id: 's1',
          name: 'Hero',
          type: 'section',
          className: 'bg-red-500',
          children: [
            {
              id: 'e1',
              type: 'text',
              tag: 'h1',
              content: 'Hello World',
              className: 'text-xl'
            }
          ]
        }
      ]

      const code = generateReactCode(blocks)

      expect(code).toContain('<section className="bg-red-500">')
      expect(code).toContain('<h1 className="text-xl">Hello World</h1>')
    })

    it('should render a button element', () => {
      const blocks: SectionBlock[] = [
        {
          id: 's1',
          name: 'CTA',
          type: 'section',
          className: 'flex',
          children: [
            {
              id: 'b1',
              type: 'button',
              content: 'Click Me',
              className: 'btn-primary'
            }
          ]
        }
      ]

      const code = generateReactCode(blocks)
      expect(code).toContain('<button className="btn-primary">Click Me</button>')
    })

    it('should render generic container with children', () => {
        const blocks: SectionBlock[] = [
            {
                id: 's1', name: 'Wrappers', type: 'section', className: 'p-4',
                children: [
                    {
                        id: 'c1', type: 'container', className: 'grid', children: [
                             { id: 't1', type: 'text', tag: 'p', content: 'Nested', className: '' }
                        ]
                    }
                ]
            }
        ]

        const code = generateReactCode(blocks)
        expect(code).toContain('<div className="grid">')
        expect(code).toContain('<p >Nested</p>')
    })
  })
})
