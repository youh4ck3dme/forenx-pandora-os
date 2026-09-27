import { useMemo, useRef, useState } from 'react';
import { createPortal, useFrame } from '@react-three/fiber';
import { Scene, OrthographicCamera } from 'three';
import { damp } from './damp';
import { useGlFbo } from './useGlFbo';
import { DofPointsMaterial } from './shaders/pointMaterial';
import { SimulationMaterial } from './shaders/simulationMaterial';

export function Particles({
    speed = 1.0,
    aperture = 1.79,
    focus = 3.8,
    size = 256,
    noiseScale = 0.6,
    noiseIntensity = 0.52,
    timeScale = 1.0,
    pointSize = 10.0,
    opacity = 0.8,
    planeScale = 10.0,
    hovering = false,
}: {
    speed?: number;
    aperture?: number;
    focus?: number;
    size?: number;
    noiseScale?: number;
    noiseIntensity?: number;
    timeScale?: number;
    pointSize?: number;
    opacity?: number;
    planeScale?: number;
    hovering?: boolean;
}) {
    const revealStartTime = useRef<number | null>(null);
    const revealDuration = 3.5;

    const simulationMaterial = useMemo(() => new SimulationMaterial(planeScale, size), [planeScale, size]);
    const target = useGlFbo(size, size);

    const dofPointsMaterial = useMemo(() => {
        const m = new DofPointsMaterial();
        m.uniforms.positions.value = target.texture;
        m.uniforms.initialPositions.value = simulationMaterial.uniforms.positions.value;
        return m;
    }, [simulationMaterial, target.texture]);

    const [scene] = useState(() => new Scene());
    const [camera] = useState(
        () => new OrthographicCamera(-1, 1, 1, -1, 1 / Number.MAX_SAFE_INTEGER, 1),
    );
    const [quadPositions] = useState(() => new Float32Array([
        -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0,
    ]));
    const [quadUvs] = useState(() => new Float32Array([0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0]));

    const particles = useMemo(() => {
        const length = size * size;
        const out = new Float32Array(length * 3);
        for (let i = 0; i < length; i += 1) {
            const i3 = i * 3;
            out[i3 + 0] = (i % size) / size;
            out[i3 + 1] = i / size / size;
        }
        return out;
    }, [size]);

    useFrame((state, delta) => {
        state.gl.setRenderTarget(target);
        state.gl.clear();
        state.gl.render(scene, camera);
        state.gl.setRenderTarget(null);

        const currentTime = state.clock.elapsedTime;
        if (revealStartTime.current === null) {
            revealStartTime.current = currentTime;
        }

        const revealElapsed = currentTime - revealStartTime.current;
        const revealProgress = Math.min(revealElapsed / revealDuration, 1.0);
        const easedProgress = 1 - Math.pow(1 - revealProgress, 3);
        const revealFactor = easedProgress * 4.0;

        dofPointsMaterial.uniforms.uTime.value = currentTime;
        dofPointsMaterial.uniforms.uFocus.value = focus;
        dofPointsMaterial.uniforms.uBlur.value = aperture;
        dofPointsMaterial.uniforms.uPointSize.value = pointSize;
        dofPointsMaterial.uniforms.uOpacity.value = opacity;
        dofPointsMaterial.uniforms.uRevealFactor.value = revealFactor;
        dofPointsMaterial.uniforms.uRevealProgress.value = easedProgress;
        damp(dofPointsMaterial.uniforms.uTransition, 'value', hovering ? 1.0 : 0.0, hovering ? 0.35 : 0.2, delta);

        simulationMaterial.uniforms.uTime.value = currentTime;
        simulationMaterial.uniforms.uNoiseScale.value = noiseScale;
        simulationMaterial.uniforms.uNoiseIntensity.value = noiseIntensity;
        simulationMaterial.uniforms.uTimeScale.value = timeScale * speed;
    });

    return (
        <>
            {createPortal(
                <mesh material={simulationMaterial}>
                    <bufferGeometry>
                        <bufferAttribute attach="attributes-position" args={[quadPositions, 3]} />
                        <bufferAttribute attach="attributes-uv" args={[quadUvs, 2]} />
                    </bufferGeometry>
                </mesh>,
                scene
            )}
            <points material={dofPointsMaterial}>
                <bufferGeometry>
                    <bufferAttribute attach="attributes-position" args={[particles, 3]} />
                </bufferGeometry>
            </points>
        </>
    );
}
