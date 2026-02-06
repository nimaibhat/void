"use client";

import { useRef, useMemo, useCallback, useEffect } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  EffectComposer,
  Bloom,
  Vignette,
} from "@react-three/postprocessing";
import * as THREE from "three";

const PARTICLE_COUNT = 2000;
const GLOBE_RADIUS = 1.8;
const MOUSE_INFLUENCE_RADIUS = 4.5;
const MOUSE_PUSH_STRENGTH = 2.4;
const NOISE_SPEED = 0.3;
const ROTATION_SPEED = 0.08;

/* ------------------------------------------------------------------ */
/*  Cheap 3-D simplex-ish noise (good enough for organic distortion)  */
/* ------------------------------------------------------------------ */
function pseudoNoise(x: number, y: number, z: number): number {
  const n = Math.sin(x * 12.9898 + y * 78.233 + z * 45.164) * 43758.5453;
  return (n - Math.floor(n)) * 2 - 1;
}

function fbm(x: number, y: number, z: number): number {
  let v = 0;
  let a = 0.5;
  let px = x,
    py = y,
    pz = z;
  for (let i = 0; i < 4; i++) {
    v += a * pseudoNoise(px, py, pz);
    px *= 2.0;
    py *= 2.0;
    pz *= 2.0;
    a *= 0.5;
  }
  return v;
}

/* ------------------------------------------------------------------ */
/*  Fibonacci sphere — even distribution of points on a sphere        */
/* ------------------------------------------------------------------ */
function fibonacciSphere(count: number, radius: number) {
  const positions = new Float32Array(count * 3);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = goldenAngle * i;
    positions[i * 3] = Math.cos(theta) * r * radius;
    positions[i * 3 + 1] = y * radius;
    positions[i * 3 + 2] = Math.sin(theta) * r * radius;
  }
  return positions;
}

/* ------------------------------------------------------------------ */
/*  The actual Points mesh                                            */
/* ------------------------------------------------------------------ */
function Globe() {
  const pointsRef = useRef<THREE.Points>(null);
  const { viewport } = useThree();

  // Persistent mouse in world-ish coords
  const mouse3D = useRef(new THREE.Vector3(100, 100, 0)); // start offscreen
  const smoothMouse = useRef(new THREE.Vector3(100, 100, 0));

  // Base positions (Fibonacci sphere)
  const basePositions = useMemo(
    () => fibonacciSphere(PARTICLE_COUNT, GLOBE_RADIUS),
    []
  );

  // Current positions buffer
  const currentPositions = useMemo(
    () => new Float32Array(basePositions),
    [basePositions]
  );

  // Random per-particle data for variation
  const particleData = useMemo(() => {
    const sizes = new Float32Array(PARTICLE_COUNT);
    const phases = new Float32Array(PARTICLE_COUNT);
    const brightnesses = new Float32Array(PARTICLE_COUNT);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      sizes[i] = 0.8 + Math.random() * 2.2;
      phases[i] = Math.random() * Math.PI * 2;
      brightnesses[i] = 0.4 + Math.random() * 0.6;
    }
    return { sizes, phases, brightnesses };
  }, []);

  // Colors: vary green hue
  const colors = useMemo(() => {
    const c = new Float32Array(PARTICLE_COUNT * 3);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const b = particleData.brightnesses[i];
      // Green channel dominant, slight cyan/yellow drift
      c[i * 3] = (0.15 + Math.random() * 0.2) * b; // R
      c[i * 3 + 1] = (0.85 + Math.random() * 0.15) * b; // G
      c[i * 3 + 2] = (0.1 + Math.random() * 0.35) * b; // B
    }
    return c;
  }, [particleData.brightnesses]);

  // Track pointer via native events on the canvas (not just the mesh)
  // so we get continuous tracking even between particles
  const { gl } = useThree();
  const onPointerMoveNative = useCallback(
    (e: PointerEvent) => {
      const rect = gl.domElement.getBoundingClientRect();
      // Normalise to -1…1
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      mouse3D.current.set(
        nx * viewport.width * 0.5,
        ny * viewport.height * 0.5,
        0
      );
    },
    [viewport, gl]
  );

  const onPointerLeave = useCallback(() => {
    // Move mouse offscreen when cursor leaves
    mouse3D.current.set(100, 100, 0);
  }, []);

  // Attach/detach native listeners
  useEffect(() => {
    const el = gl.domElement;
    el.addEventListener("pointermove", onPointerMoveNative);
    el.addEventListener("pointerleave", onPointerLeave);
    return () => {
      el.removeEventListener("pointermove", onPointerMoveNative);
      el.removeEventListener("pointerleave", onPointerLeave);
    };
  }, [gl, onPointerMoveNative, onPointerLeave]);

  useFrame((state) => {
    if (!pointsRef.current) return;
    const t = state.clock.elapsedTime;

    // Smooth follow — fast response
    smoothMouse.current.lerp(mouse3D.current, 0.25);

    const geo = pointsRef.current.geometry;
    const posAttr = geo.getAttribute("position") as THREE.BufferAttribute;
    const posArr = posAttr.array as Float32Array;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const i3 = i * 3;

      // Base pos (already on sphere)
      let bx = basePositions[i3];
      let by = basePositions[i3 + 1];
      let bz = basePositions[i3 + 2];

      // Rotate base around Y for constant spin
      const angle = t * ROTATION_SPEED + particleData.phases[i] * 0.02;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      const rx = bx * cosA + bz * sinA;
      const rz = -bx * sinA + bz * cosA;
      bx = rx;
      bz = rz;

      // Organic noise distortion (breathing)
      const noiseVal = fbm(
        bx * 0.4 + t * NOISE_SPEED,
        by * 0.4,
        bz * 0.4
      );
      const noiseDisplace = noiseVal * 0.25;

      // Normalised direction from center
      const len = Math.sqrt(bx * bx + by * by + bz * bz) || 1;
      const nx = bx / len;
      const ny = by / len;
      const nz = bz / len;

      // Apply noise along normal
      let fx = bx + nx * noiseDisplace;
      let fy = by + ny * noiseDisplace;
      let fz = bz + nz * noiseDisplace;

      // --- Mouse interaction (screen-space, so center particles react) ---
      const dx = fx - smoothMouse.current.x;
      const dy = fy - smoothMouse.current.y;
      // Use only XY distance so depth doesn't kill the interaction
      const screenDist = Math.sqrt(dx * dx + dy * dy);
      if (screenDist < MOUSE_INFLUENCE_RADIUS) {
        const t2 = 1 - screenDist / MOUSE_INFLUENCE_RADIUS;
        // Cubic falloff for aggressive center, smooth edges
        const strength = t2 * t2 * t2;
        const push = strength * MOUSE_PUSH_STRENGTH;
        // Push outward from center of globe (radially) for 3D feel
        const radLen = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1;
        const rx = fx / radLen;
        const ry = fy / radLen;
        const rz = fz / radLen;
        // Blend between screen-plane push and radial push
        const screenInvD = 1 / (screenDist || 0.001);
        fx += (dx * screenInvD * 0.4 + rx * 0.6) * push;
        fy += (dy * screenInvD * 0.4 + ry * 0.6) * push;
        fz += rz * push * 0.8;
      }

      // Pulsing size tweak (handled via scale in shader, but we can
      // also subtly move particles radially for a "breathing" effect)
      const pulse = Math.sin(t * 1.2 + particleData.phases[i]) * 0.04;
      fx += nx * pulse;
      fy += ny * pulse;
      fz += nz * pulse;

      // Smooth interpolation toward target (snappy spring)
      posArr[i3] += (fx - posArr[i3]) * 0.18;
      posArr[i3 + 1] += (fy - posArr[i3 + 1]) * 0.18;
      posArr[i3 + 2] += (fz - posArr[i3 + 2]) * 0.18;
    }

    posAttr.needsUpdate = true;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[currentPositions, 3]}
          count={PARTICLE_COUNT}
        />
        <bufferAttribute
          attach="attributes-color"
          args={[colors, 3]}
          count={PARTICLE_COUNT}
        />
        <bufferAttribute
          attach="attributes-size"
          args={[particleData.sizes, 1]}
          count={PARTICLE_COUNT}
        />
      </bufferGeometry>
      <shaderMaterial
        vertexColors
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        vertexShader={`
          attribute float size;
          varying vec3 vColor;
          void main() {
            vColor = color;
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = size * (200.0 / -mvPosition.z);
            gl_Position = projectionMatrix * mvPosition;
          }
        `}
        fragmentShader={`
          varying vec3 vColor;
          void main() {
            float d = length(gl_PointCoord - vec2(0.5));
            if (d > 0.5) discard;
            float alpha = 1.0 - smoothstep(0.0, 0.5, d);
            alpha = pow(alpha, 1.5);
            gl_FragColor = vec4(vColor * 1.5, alpha * 0.85);
          }
        `}
      />
    </points>
  );
}

/* ------------------------------------------------------------------ */
/*  Ambient floating particles (tiny specs in the bg)                 */
/* ------------------------------------------------------------------ */
function AmbientDust() {
  const ref = useRef<THREE.Points>(null);
  const count = 600;
  const positions = useMemo(() => {
    const p = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      p[i * 3] = (Math.random() - 0.5) * 20;
      p[i * 3 + 1] = (Math.random() - 0.5) * 20;
      p[i * 3 + 2] = (Math.random() - 0.5) * 20;
    }
    return p;
  }, []);

  useFrame((state) => {
    if (!ref.current) return;
    ref.current.rotation.y = state.clock.elapsedTime * 0.01;
    ref.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.008) * 0.1;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
          count={count}
        />
      </bufferGeometry>
      <shaderMaterial
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        vertexShader={`
          void main() {
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = 3.0 * (100.0 / -mvPosition.z);
            gl_Position = projectionMatrix * mvPosition;
          }
        `}
        fragmentShader={`
          void main() {
            float d = length(gl_PointCoord - vec2(0.5));
            if (d > 0.5) discard;
            float alpha = 1.0 - smoothstep(0.0, 0.5, d);
            gl_FragColor = vec4(0.18, 1.0, 0.43, alpha * 0.3);
          }
        `}
      />
    </points>
  );
}

/* ------------------------------------------------------------------ */
/*  Main export — canvas + post-processing                           */
/* ------------------------------------------------------------------ */
export default function ParticleGlobe() {
  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <Canvas
        camera={{ position: [0, 0, 7.5], fov: 50 }}
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: "high-performance",
        }}
        style={{ background: "transparent" }}
        dpr={[1, 2]}
      >
        <color attach="background" args={["#0a0a0a"]} />
        <ambientLight intensity={0.1} />

        <Globe />
        <AmbientDust />

        <EffectComposer>
          <Bloom
            luminanceThreshold={0.1}
            luminanceSmoothing={0.9}
            intensity={1.8}
            mipmapBlur
          />
          <Vignette eskil={false} offset={0.1} darkness={0.8} />
        </EffectComposer>
      </Canvas>
    </div>
  );
}
