'use client'

/**
 * GPU Tier Detection Utility
 * Determines optimal particle count based on device capabilities
 */

export type GPUTier = 0 | 1 | 2 | 3

export interface GPUInfo {
    tier: GPUTier
    isMobile: boolean
    particleSize: 64 | 128 | 256 | 512
    description: string
}

/**
 * Detects GPU tier and returns optimal settings for particle system
 */
export function detectGPUTier(): GPUInfo {
    if (typeof window === 'undefined') {
        return { tier: 1, isMobile: false, particleSize: 128, description: 'SSR fallback' }
    }

    const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

    // Try to get GPU info from WebGL
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl')

    let gpuVendor = ''
    let gpuRenderer = ''

    if (gl) {
        const debugInfo = (gl as WebGLRenderingContext).getExtension('WEBGL_debug_renderer_info')
        if (debugInfo) {
            gpuVendor = (gl as WebGLRenderingContext).getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || ''
            gpuRenderer = (gl as WebGLRenderingContext).getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || ''
        }
    }

    const renderer = gpuRenderer.toLowerCase()

    // Tier 0: Very low-end or software rendering
    if (
        renderer.includes('swiftshader') ||
        renderer.includes('llvmpipe') ||
        renderer.includes('software') ||
        !gl
    ) {
        return { tier: 0, isMobile, particleSize: 64, description: 'Software/Low-end GPU' }
    }

    // Tier 1: Mobile or integrated Intel
    if (
        isMobile ||
        renderer.includes('intel') ||
        renderer.includes('mali') ||
        renderer.includes('adreno 5') ||
        renderer.includes('powervr')
    ) {
        return { tier: 1, isMobile, particleSize: 128, description: 'Mobile/Integrated GPU' }
    }

    // Tier 2: Mid-range dedicated GPUs
    if (
        renderer.includes('adreno 6') ||
        renderer.includes('geforce gtx') ||
        renderer.includes('radeon rx 5') ||
        renderer.includes('radeon rx 6') ||
        renderer.includes('apple m1') ||
        renderer.includes('apple m2')
    ) {
        return { tier: 2, isMobile, particleSize: 256, description: 'Mid-range GPU' }
    }

    // Tier 3: High-end GPUs
    if (
        renderer.includes('geforce rtx') ||
        renderer.includes('radeon rx 7') ||
        renderer.includes('apple m3') ||
        renderer.includes('apple m4')
    ) {
        return { tier: 3, isMobile, particleSize: 512, description: 'High-end GPU' }
    }

    // Default to tier 2 for unknown dedicated GPUs
    return { tier: 2, isMobile, particleSize: 256, description: 'Unknown GPU (default mid-range)' }
}

/**
 * Hook-friendly version that caches the result
 */
let cachedGPUInfo: GPUInfo | null = null

export function getGPUInfo(): GPUInfo {
    if (cachedGPUInfo) return cachedGPUInfo
    cachedGPUInfo = detectGPUTier()
    return cachedGPUInfo
}
