import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import {
    NearestFilter,
    RGBAFormat,
    FloatType,
    WebGLRenderTarget,
} from 'three';

/** Lightweight FBO — avoids pulling in @react-three/drei. */
export function useGlFbo(width: number, height: number, options: Record<string, any> = {}) {
    const { gl } = useThree();
    const target = useMemo(
        () =>
            new WebGLRenderTarget(width, height, {
                minFilter: NearestFilter,
                magFilter: NearestFilter,
                format: RGBAFormat,
                type: FloatType,
                ...options,
            }),
        [width, height, options],
    );

    useEffect(() => () => target.dispose(), [target]);

    return target;
}
