import { describe, it, expect } from 'vitest'
import { cn, px } from '../utils'

describe('utils', () => {
  describe('cn', () => {
    it('should merge class names correctly', () => {
      expect(cn('c1', 'c2')).toBe('c1 c2')
    })

    it('should handle conditional classes', () => {
      expect(cn('c1', false && 'c2', 'c3')).toBe('c1 c3')
    })

    it('should merge tailwind classes', () => {
      expect(cn('p-4', 'p-2')).toBe('p-2')
    })
  })

  describe('px', () => {
    it('should append px suffix to numbers', () => {
      expect(px(10)).toBe('10px')
      expect(px(0)).toBe('0px')
    })
  })
})
