import { describe, it, expect } from 'vitest'
import { FORGE_COMPONENTS, ComponentTemplate } from '../forge'

describe('Forge Components', () => {
    it('should have valid component definitions', () => {
        const components = Object.values(FORGE_COMPONENTS);
        expect(components.length).toBeGreaterThan(0)

        components.forEach((comp: any) => {
            expect(comp).toHaveProperty('type')
            expect(comp).toHaveProperty('name')
            expect(comp).toHaveProperty('className')
            expect(comp).toHaveProperty('children')
        })
    })

    it('should have valid template structure', () => {
        const hero = FORGE_COMPONENTS['hero-modern']
        expect(hero).toBeDefined()
        const template = hero as ComponentTemplate
        expect(template.type).toBe('section')
        expect(template.children.length).toBeGreaterThan(0)
    })
})
