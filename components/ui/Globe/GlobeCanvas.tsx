import React from "react";
import { Canvas } from "@react-three/fiber";
import { Particles } from "./particles";

export const GlobeCanvas = ({
  hovering = false,
  className = "",
  style,
}: {
  hovering?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) => {
  return (
    <div
      className={`pointer-events-none absolute inset-0 m-auto flex items-center justify-center ${className}`}
      style={{
        maxWidth: "100%",
        width: "100%",
        height: "100%",
        aspectRatio: "1",
        maxHeight: "100vh",
        zIndex: 0,
        ...style,
      }}
    >
      <Canvas
        dpr={[1, 1.5]}
        camera={{
          position: [1.2629783123, 2.6646064713, -1.8178993743],
          fov: 50,
          near: 0.01,
          far: 300,
        }}
        gl={{ alpha: true, antialias: true }}
        style={{ backgroundColor: "transparent", width: "100%", height: "100%" }}
      >
        <Particles
          speed={1.15}
          aperture={2.05}
          focus={3.5}
          size={256}
          noiseScale={0.74}
          noiseIntensity={0.78}
          timeScale={1.15}
          pointSize={15.5}
          opacity={1.0}
          planeScale={10.0}
          hovering={hovering}
        />
      </Canvas>
    </div>
  );
};
