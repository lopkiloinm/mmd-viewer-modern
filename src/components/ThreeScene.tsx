import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from '@three-jsm/controls/OrbitControls.js';
import { EffectComposer } from '@three-jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '@three-jsm/postprocessing/RenderPass.js';
import { ShaderPass } from '@three-jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from '@three-jsm/postprocessing/UnrealBloomPass.js';
import { BokehPass } from '@three-jsm/postprocessing/BokehPass.js';
import { GTAOPass } from '@three-jsm/postprocessing/GTAOPass.js';
import { AfterimagePass } from '@three-jsm/postprocessing/AfterimagePass.js';
import { GlitchPass } from '@three-jsm/postprocessing/GlitchPass.js';
import { OutputPass } from '@three-jsm/postprocessing/OutputPass.js';
import { HueSaturationShader } from '@three-jsm/shaders/HueSaturationShader.js';
import { VignetteShader } from '@three-jsm/shaders/VignetteShader.js';
import { BrightnessContrastShader } from '@three-jsm/shaders/BrightnessContrastShader.js';
import { SepiaShader } from '@three-jsm/shaders/SepiaShader.js';
import { RoomEnvironment } from '@three-jsm/environments/RoomEnvironment.js';
import { type Character } from '../hooks/useModelLoader';
import {
  syncCharacterPhysicalMaterials,
  syncIblStudioPortraitMaterials,
} from '../utils/characterPhysicalMaterials';

type ColorGradingPreset = 'neutral' | 'cinematic' | 'anime' | 'cool' | 'warm';
type GlowPreset = 'studio' | 'soft' | 'neon' | 'dream';

export interface ViewportEffects {
  // Lighting & Tone
  toneMappingEnabled: boolean;
  toneMappingStrength: number;
  colorGradingEnabled: boolean;
  colorGradingStrength: number;
  colorGradingPreset: ColorGradingPreset;
  brightnessContrastEnabled: boolean;
  brightnessContrastStrength: number;
  // PBR (MeshPhysical + IBL)
  meshPhysicalEnabled: boolean;
  meshPhysicalStrength: number;
  /** Additive screen-space halo on mesh silhouettes (runs before bloom). */
  meshRimGlowEnabled: boolean;
  meshRimGlowStrength: number;
  /** Softer IBL-driven portrait lighting + optional diffusion hints on MeshPhysical (path-style offline look, real-time). */
  iblStudioPortraitEnabled: boolean;
  iblStudioPortraitStrength: number;
  // Atmosphere
  bloomEnabled: boolean;
  bloomStrength: number;
  glowPreset: GlowPreset;
  depthOfFieldEnabled: boolean;
  depthOfFieldStrength: number;
  ambientOcclusionEnabled: boolean;
  ambientOcclusionStrength: number;
  vignetteEnabled: boolean;
  vignetteStrength: number;
  // Stylization
  toonShadingEnabled: boolean;
  toonShadingStrength: number;
  outlineEnabled: boolean;
  outlineStrength: number;
  posterizeEnabled: boolean;
  posterizeStrength: number;
  pixelateEnabled: boolean;
  pixelateStrength: number;
  // Motion & FX
  afterimageEnabled: boolean;
  afterimageStrength: number;
  glitchEnabled: boolean;
  glitchStrength: number;
  chromaticAberrationEnabled: boolean;
  chromaticAberrationStrength: number;
  filmGrainEnabled: boolean;
  filmGrainStrength: number;
  sharpenEnabled: boolean;
  sharpenStrength: number;
  sepiaEnabled: boolean;
  sepiaStrength: number;
}

/**
 * Dithered cel shading: quantizes luminance into bands with screen-space noise
 * at thresholds. This avoids the old sigmoid pass, whose iso-luminance contours
 * aligned with mesh shading and looked like "shadow stripes" on curved surfaces.
 */
const CelShadeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    strength: { value: 0.5 },
    bands: { value: 4.0 },
    ditherAmount: { value: 0.04 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float strength;
    uniform float bands;
    uniform float ditherAmount;
    varying vec2 vUv;

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      float lum = dot(color.rgb, vec3(0.299, 0.587, 0.114));

      float h = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
      float h2 = fract(sin(dot(gl_FragCoord.xy * 0.713, vec2(45.164, 94.673))) * 19102.7);
      float jitter = (h + h2 - 1.0) * 0.5;
      float lumJ = clamp(lum + jitter * ditherAmount, 0.001, 0.999);

      float n = max(bands, 2.0);
      float q = floor(lumJ * n) / max(n - 1.0, 1.0);
      vec3 cel = color.rgb * (q / max(lum, 0.001));

      gl_FragColor = vec4(mix(color.rgb, cel, strength), color.a);
    }
  `,
};

const ChromaticAberrationShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    offset: { value: 0.005 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float offset;
    varying vec2 vUv;
    void main() {
      vec2 dir = vUv - vec2(0.5);
      float r = texture2D(tDiffuse, vUv + dir * offset).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv - dir * offset).b;
      float a = texture2D(tDiffuse, vUv).a;
      gl_FragColor = vec4(r, g, b, a);
    }
  `,
};

const FilmGrainShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    amount: { value: 0.08 },
    time: { value: 0.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float amount;
    uniform float time;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      float noise = fract(sin(dot(vUv + vec2(time), vec2(12.9898, 78.233))) * 43758.5453);
      color.rgb += (noise - 0.5) * amount;
      gl_FragColor = color;
    }
  `,
};

const SharpenShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    resolution: { value: new THREE.Vector2(1, 1) },
    strength: { value: 0.5 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float strength;
    varying vec2 vUv;
    void main() {
      vec2 texel = 1.0 / resolution;
      vec4 center = texture2D(tDiffuse, vUv);
      vec4 top    = texture2D(tDiffuse, vUv + vec2(0.0, texel.y));
      vec4 bottom = texture2D(tDiffuse, vUv - vec2(0.0, texel.y));
      vec4 left   = texture2D(tDiffuse, vUv - vec2(texel.x, 0.0));
      vec4 right  = texture2D(tDiffuse, vUv + vec2(texel.x, 0.0));
      vec4 sharpened = center + (center * 4.0 - top - bottom - left - right) * strength;
      gl_FragColor = vec4(clamp(sharpened.rgb, 0.0, 1.0), center.a);
    }
  `,
};

const PosterizeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    levels: { value: 8.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float levels;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      float d = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
      vec3 j = color.rgb + (d - 0.5) * (0.5 / max(levels, 1.0));
      color.rgb = floor(j * levels + 0.5) / levels;
      gl_FragColor = color;
    }
  `,
};

const ScreenSpaceEdgeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    resolution: { value: new THREE.Vector2(1, 1) },
    edgeStrength: { value: 1.0 },
    threshold: { value: 0.06 },
    darkness: { value: 0.8 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float edgeStrength;
    uniform float threshold;
    uniform float darkness;
    varying vec2 vUv;

    float luminance(vec3 c) {
      return dot(c, vec3(0.299, 0.587, 0.114));
    }

    void main() {
      vec2 texel = 1.0 / resolution;
      vec4 color = texture2D(tDiffuse, vUv);

      // Sample 3x3 neighbourhood luminance
      float tl = luminance(texture2D(tDiffuse, vUv + vec2(-texel.x,  texel.y)).rgb);
      float tc = luminance(texture2D(tDiffuse, vUv + vec2(     0.0,  texel.y)).rgb);
      float tr = luminance(texture2D(tDiffuse, vUv + vec2( texel.x,  texel.y)).rgb);
      float ml = luminance(texture2D(tDiffuse, vUv + vec2(-texel.x,      0.0)).rgb);
      float mr = luminance(texture2D(tDiffuse, vUv + vec2( texel.x,      0.0)).rgb);
      float bl = luminance(texture2D(tDiffuse, vUv + vec2(-texel.x, -texel.y)).rgb);
      float bc = luminance(texture2D(tDiffuse, vUv + vec2(     0.0, -texel.y)).rgb);
      float br = luminance(texture2D(tDiffuse, vUv + vec2( texel.x, -texel.y)).rgb);

      // Sobel operator
      float gx = -tl - 2.0*ml - bl + tr + 2.0*mr + br;
      float gy = -tl - 2.0*tc - tr + bl + 2.0*bc + br;
      float edge = sqrt(gx * gx + gy * gy);

      // Soft threshold: smoothstep for anti-aliased thin lines
      float edgeMask = smoothstep(threshold, threshold + 0.04, edge * edgeStrength);

      // Darken where edges detected (thin dark lines)
      vec3 result = color.rgb * mix(1.0, 1.0 - darkness, edgeMask);
      gl_FragColor = vec4(result, color.a);
    }
  `,
};

/** Soft additive rim from luminance edges + neighborhood bleed (placed before bloom). */
const SoftMeshRimGlowShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    resolution: { value: new THREE.Vector2(1, 1) },
    strength: { value: 0.35 },
    radius: { value: 3.8 },
    glowTint: { value: new THREE.Vector3(0.72, 0.84, 1.0) },
    edgeBias: { value: 1.05 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float strength;
    uniform float radius;
    uniform vec3 glowTint;
    uniform float edgeBias;
    varying vec2 vUv;

    float luminance(vec3 c) {
      return dot(c, vec3(0.299, 0.587, 0.114));
    }

    void main() {
      vec2 texel = 1.0 / resolution;
      vec4 color = texture2D(tDiffuse, vUv);

      float tl = luminance(texture2D(tDiffuse, vUv + vec2(-texel.x,  texel.y)).rgb);
      float tc = luminance(texture2D(tDiffuse, vUv + vec2(     0.0,  texel.y)).rgb);
      float tr = luminance(texture2D(tDiffuse, vUv + vec2( texel.x,  texel.y)).rgb);
      float ml = luminance(texture2D(tDiffuse, vUv + vec2(-texel.x,      0.0)).rgb);
      float mr = luminance(texture2D(tDiffuse, vUv + vec2( texel.x,      0.0)).rgb);
      float bl = luminance(texture2D(tDiffuse, vUv + vec2(-texel.x, -texel.y)).rgb);
      float bc = luminance(texture2D(tDiffuse, vUv + vec2(     0.0, -texel.y)).rgb);
      float br = luminance(texture2D(tDiffuse, vUv + vec2( texel.x, -texel.y)).rgb);

      float gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
      float gy = -tl - 2.0 * tc - tr + bl + 2.0 * bc + br;
      float edge = sqrt(gx * gx + gy * gy) * edgeBias;
      float rim = smoothstep(0.035, 0.26, edge);

      vec3 neighbor = vec3(0.0);
      neighbor += texture2D(tDiffuse, vUv + vec2(1.0, 0.0) * texel * radius).rgb;
      neighbor += texture2D(tDiffuse, vUv + vec2(0.707, 0.707) * texel * radius).rgb;
      neighbor += texture2D(tDiffuse, vUv + vec2(0.0, 1.0) * texel * radius).rgb;
      neighbor += texture2D(tDiffuse, vUv + vec2(-0.707, 0.707) * texel * radius).rgb;
      neighbor += texture2D(tDiffuse, vUv + vec2(-1.0, 0.0) * texel * radius).rgb;
      neighbor += texture2D(tDiffuse, vUv + vec2(-0.707, -0.707) * texel * radius).rgb;
      neighbor += texture2D(tDiffuse, vUv + vec2(0.0, -1.0) * texel * radius).rgb;
      neighbor += texture2D(tDiffuse, vUv + vec2(0.707, -0.707) * texel * radius).rgb;
      neighbor *= 0.125;
      float nL = luminance(neighbor);
      vec3 add = glowTint * rim * strength * (0.28 + 0.72 * nL);
      gl_FragColor = vec4(color.rgb + add, color.a);
    }
  `,
};

const PixelateShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    resolution: { value: new THREE.Vector2(1, 1) },
    pixelSize: { value: 4.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float pixelSize;
    varying vec2 vUv;
    void main() {
      vec2 dxy = pixelSize / resolution;
      vec2 coord = dxy * floor(vUv / dxy);
      gl_FragColor = texture2D(tDiffuse, coord);
    }
  `,
};

const defaultEffects: ViewportEffects = {
  toneMappingEnabled: true,
  toneMappingStrength: 0.28,
  colorGradingEnabled: true,
  colorGradingStrength: 0.35,
  colorGradingPreset: 'cinematic',
  brightnessContrastEnabled: false,
  brightnessContrastStrength: 0.5,
  meshPhysicalEnabled: false,
  meshPhysicalStrength: 0.45,
  meshRimGlowEnabled: false,
  meshRimGlowStrength: 0.4,
  iblStudioPortraitEnabled: false,
  iblStudioPortraitStrength: 0.45,
  bloomEnabled: true,
  bloomStrength: 0.22,
  glowPreset: 'studio',
  depthOfFieldEnabled: false,
  depthOfFieldStrength: 0.25,
  ambientOcclusionEnabled: true,
  ambientOcclusionStrength: 0.38,
  vignetteEnabled: false,
  vignetteStrength: 0.35,
  toonShadingEnabled: false,
  toonShadingStrength: 0.5,
  outlineEnabled: false,
  outlineStrength: 0.4,
  posterizeEnabled: false,
  posterizeStrength: 0.4,
  pixelateEnabled: false,
  pixelateStrength: 0.3,
  afterimageEnabled: false,
  afterimageStrength: 0.18,
  glitchEnabled: false,
  glitchStrength: 0.18,
  chromaticAberrationEnabled: false,
  chromaticAberrationStrength: 0.3,
  filmGrainEnabled: false,
  filmGrainStrength: 0.25,
  sharpenEnabled: false,
  sharpenStrength: 0.3,
  sepiaEnabled: false,
  sepiaStrength: 0.4,
};

const COLOR_GRADING_PROFILES: Record<ColorGradingPreset, { hue: number; saturation: number; exposure: number }> = {
  neutral: { hue: 0, saturation: 0.04, exposure: 1.0 },
  cinematic: { hue: -0.01, saturation: 0.3, exposure: 0.97 },
  anime: { hue: 0.015, saturation: 0.4, exposure: 1.02 },
  cool: { hue: -0.025, saturation: 0.24, exposure: 0.95 },
  warm: { hue: 0.02, saturation: 0.22, exposure: 1.0 },
};

const BLOOM_PROFILES: Record<GlowPreset, { threshold: number; radius: number; minStrength: number; maxStrength: number }> = {
  studio: { threshold: 0.9, radius: 0.32, minStrength: 0.08, maxStrength: 1.15 },
  soft: { threshold: 0.95, radius: 0.45, minStrength: 0.06, maxStrength: 0.85 },
  neon: { threshold: 0.82, radius: 0.28, minStrength: 0.14, maxStrength: 1.75 },
  dream: { threshold: 0.87, radius: 0.58, minStrength: 0.1, maxStrength: 1.25 },
};

const DIFFUSION_PRESET = {
  focus: 1.0,
  maxblurMin: 0.001,
  maxblurMax: 0.015,
  apertureMin: 0.00001,
  apertureMax: 0.00008,
};

/** GTAO + Poisson denoise — tuned for character work (fewer contour artifacts than SSAO). */
const AO_PRESET = {
  blendIntensityMin: 0.14,
  blendIntensityMax: 0.68,
  radiusMin: 0.14,
  radiusMax: 0.36,
  thicknessMin: 0.75,
  thicknessMax: 1.35,
};

interface ThreeSceneProps {
  className?: string;
  characters?: Character[];
  activeCamera?: THREE.PerspectiveCamera | null;
  effects?: ViewportEffects;
  previewAspect?: number;
  defaultStageVisible?: boolean;
  onSceneReady?: (
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    controls: OrbitControls,
    captureApi: ThreeSceneCaptureApi,
  ) => void;
}

export interface ThreeSceneCaptureApi {
  capturePngFrame: (width: number, height: number) => Promise<Blob>;
  setPaused: (paused: boolean) => void;
}

export const ThreeScene: React.FC<ThreeSceneProps> = ({
  className,
  characters = [],
  activeCamera = null,
  effects = defaultEffects,
  previewAspect,
  defaultStageVisible = true,
  onSceneReady,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const composerRef = useRef<EffectComposer | null>(null);
  const renderPassRef = useRef<RenderPass | null>(null);
  const colorGradingPassRef = useRef<ShaderPass | null>(null);
  const bloomPassRef = useRef<UnrealBloomPass | null>(null);
  const bokehPassRef = useRef<BokehPass | null>(null);
  const aoPassRef = useRef<GTAOPass | null>(null);
  const afterimagePassRef = useRef<AfterimagePass | null>(null);
  const outlinePassRef = useRef<ShaderPass | null>(null);
  const vignettePassRef = useRef<ShaderPass | null>(null);
  const glitchPassRef = useRef<GlitchPass | null>(null);
  const outputPassRef = useRef<OutputPass | null>(null);
  const brightnessContrastPassRef = useRef<ShaderPass | null>(null);
  const toonPassRef = useRef<ShaderPass | null>(null);
  const posterizePassRef = useRef<ShaderPass | null>(null);
  const pixelatePassRef = useRef<ShaderPass | null>(null);
  const chromaticAberrationPassRef = useRef<ShaderPass | null>(null);
  const filmGrainPassRef = useRef<ShaderPass | null>(null);
  const sharpenPassRef = useRef<ShaderPass | null>(null);
  const sepiaPassRef = useRef<ShaderPass | null>(null);
  const ambientLightRef = useRef<THREE.AmbientLight | null>(null);
  const directionalLightRef = useRef<THREE.DirectionalLight | null>(null);
  const fillLightRef = useRef<THREE.DirectionalLight | null>(null);
  const rimLightRef = useRef<THREE.DirectionalLight | null>(null);
  const meshRimGlowPassRef = useRef<ShaderPass | null>(null);
  const workingFloorRef = useRef<THREE.Mesh | null>(null);
  const checkerFloorRef = useRef<THREE.Mesh | null>(null);
  const checkerFloorMaterialRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const pmremGeneratorRef = useRef<THREE.PMREMGenerator | null>(null);
  const environmentTargetRef = useRef<THREE.WebGLRenderTarget | null>(null);
  const captureApiRef = useRef<ThreeSceneCaptureApi | null>(null);
  const activeCameraRef = useRef<THREE.PerspectiveCamera | null>(activeCamera);
  const frameRef = useRef<number | null>(null);
  const lastFramedKeyRef = useRef('');
  const pausedRef = useRef(false);
  const fitViewportRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const mount = mountRef.current;

    if (!mount) {
      return;
    }

    mount.style.position = 'relative';
    mount.style.overflow = 'hidden';

    const width = mount.clientWidth || window.innerWidth;
    const height = mount.clientHeight || window.innerHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 2000);
    camera.position.set(0, 10, 22);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    rendererRef.current = renderer;
    mount.appendChild(renderer.domElement);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();
    const roomEnvironment = new RoomEnvironment(renderer);
    const environmentRt = pmremGenerator.fromScene(roomEnvironment, 0.04);
    scene.environment = environmentRt.texture;
    roomEnvironment.dispose();
    pmremGeneratorRef.current = pmremGenerator;
    environmentTargetRef.current = environmentRt;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = false;
    controls.minDistance = 1;
    controls.maxDistance = 200;
    controls.maxPolarAngle = Math.PI;
    controlsRef.current = controls;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);
    ambientLightRef.current = ambientLight;

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(10, 20, 10);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 0.1;
    directionalLight.shadow.camera.far = 1000;
    directionalLight.shadow.camera.left = -50;
    directionalLight.shadow.camera.right = 50;
    directionalLight.shadow.camera.top = 50;
    directionalLight.shadow.camera.bottom = -50;
    directionalLight.shadow.radius = 1;
    directionalLight.shadow.bias = -0.00025;
    directionalLight.shadow.normalBias = 0.027;
    scene.add(directionalLight);
    directionalLightRef.current = directionalLight;

    const fillLight = new THREE.DirectionalLight(0x8888ff, 0.35);
    fillLight.position.set(-10, 10, -5);
    scene.add(fillLight);
    fillLightRef.current = fillLight;

    const rimLight = new THREE.DirectionalLight(0xffaa44, 0.3);
    rimLight.position.set(0, 15, -15);
    scene.add(rimLight);
    rimLightRef.current = rimLight;

    const composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    renderPassRef.current = renderPass;
    composer.addPass(renderPass);

    const aoPass = new GTAOPass(scene, camera, width, height);
    aoPass.enabled = defaultEffects.ambientOcclusionEnabled;
    aoPass.output = GTAOPass.OUTPUT.Default;
    aoPass.blendIntensity = THREE.MathUtils.lerp(
      AO_PRESET.blendIntensityMin,
      AO_PRESET.blendIntensityMax,
      THREE.MathUtils.clamp(defaultEffects.ambientOcclusionStrength, 0, 1),
    );
    aoPass.updateGtaoMaterial({
      radius: THREE.MathUtils.lerp(AO_PRESET.radiusMin, AO_PRESET.radiusMax, THREE.MathUtils.clamp(defaultEffects.ambientOcclusionStrength, 0, 1)),
      thickness: THREE.MathUtils.lerp(AO_PRESET.thicknessMin, AO_PRESET.thicknessMax, THREE.MathUtils.clamp(defaultEffects.ambientOcclusionStrength, 0, 1)),
      scale: 1.0,
      samples: 16,
    });
    aoPass.updatePdMaterial({
      lumaPhi: 12.0,
      depthPhi: 2.0,
      normalPhi: 3.2,
      radius: 8.0,
    });
    composer.addPass(aoPass);
    aoPassRef.current = aoPass;

    const colorGradingPass = new ShaderPass(HueSaturationShader);
    colorGradingPass.enabled = true;
    composer.addPass(colorGradingPass);
    colorGradingPassRef.current = colorGradingPass;

    const brightnessContrastPass = new ShaderPass(BrightnessContrastShader);
    brightnessContrastPass.enabled = false;
    composer.addPass(brightnessContrastPass);
    brightnessContrastPassRef.current = brightnessContrastPass;

    const meshRimGlowPass = new ShaderPass(SoftMeshRimGlowShader);
    meshRimGlowPass.enabled = false;
    composer.addPass(meshRimGlowPass);
    meshRimGlowPassRef.current = meshRimGlowPass;

    const bokehPass = new BokehPass(scene, camera, {
      focus: DIFFUSION_PRESET.focus,
      aperture: DIFFUSION_PRESET.apertureMin,
      maxblur: DIFFUSION_PRESET.maxblurMin,
    });
    bokehPass.enabled = false;
    composer.addPass(bokehPass);
    bokehPassRef.current = bokehPass;

    const toonPass = new ShaderPass(CelShadeShader);
    toonPass.enabled = false;
    composer.addPass(toonPass);
    toonPassRef.current = toonPass;

    const posterizePass = new ShaderPass(PosterizeShader);
    posterizePass.enabled = false;
    composer.addPass(posterizePass);
    posterizePassRef.current = posterizePass;

    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      BLOOM_PROFILES.studio.minStrength,
      BLOOM_PROFILES.studio.radius,
      BLOOM_PROFILES.studio.threshold,
    );
    composer.addPass(bloomPass);
    bloomPassRef.current = bloomPass;

    const afterimagePass = new AfterimagePass();
    afterimagePass.enabled = false;
    composer.addPass(afterimagePass);
    afterimagePassRef.current = afterimagePass;

    const screenSpaceEdgePass = new ShaderPass(ScreenSpaceEdgeShader);
    screenSpaceEdgePass.enabled = false;
    composer.addPass(screenSpaceEdgePass);
    outlinePassRef.current = screenSpaceEdgePass as unknown as ShaderPass;

    const sharpenPass = new ShaderPass(SharpenShader);
    sharpenPass.enabled = false;
    composer.addPass(sharpenPass);
    sharpenPassRef.current = sharpenPass;

    const chromaticAberrationPass = new ShaderPass(ChromaticAberrationShader);
    chromaticAberrationPass.enabled = false;
    composer.addPass(chromaticAberrationPass);
    chromaticAberrationPassRef.current = chromaticAberrationPass;

    const filmGrainPass = new ShaderPass(FilmGrainShader);
    filmGrainPass.enabled = false;
    composer.addPass(filmGrainPass);
    filmGrainPassRef.current = filmGrainPass;

    const sepiaPass = new ShaderPass(SepiaShader);
    sepiaPass.enabled = false;
    composer.addPass(sepiaPass);
    sepiaPassRef.current = sepiaPass;

    const pixelatePass = new ShaderPass(PixelateShader);
    pixelatePass.enabled = false;
    composer.addPass(pixelatePass);
    pixelatePassRef.current = pixelatePass;

    const vignettePass = new ShaderPass(VignetteShader);
    vignettePass.enabled = false;
    composer.addPass(vignettePass);
    vignettePassRef.current = vignettePass;

    const glitchPass = new GlitchPass();
    glitchPass.enabled = false;
    glitchPass.goWild = false;
    composer.addPass(glitchPass);
    glitchPassRef.current = glitchPass;

    /** Always last: linear HDR chain → renderer tone mapping + sRGB (matches bloom finale path; avoids darkening when a ShaderPass is last). */
    const outputPass = new OutputPass();
    outputPass.enabled = true;
    composer.addPass(outputPass);
    outputPassRef.current = outputPass;

    const capturePngFrame = async (frameWidth: number, frameHeight: number) => {
      const targetWidth = Math.max(2, Math.round(frameWidth));
      const targetHeight = Math.max(2, Math.round(frameHeight));

      const activeRenderPass = renderPassRef.current;
      if (!activeRenderPass) {
        throw new Error('Render pass is unavailable.');
      }

      const activeAoPass = aoPassRef.current;
      const activeOutlinePass = outlinePassRef.current;

      const sourceCamera = activeRenderPass.camera;
      if (!(sourceCamera instanceof THREE.PerspectiveCamera)) {
        throw new Error('Active camera is not a perspective camera.');
      }

      const savedAspect = sourceCamera.aspect;
      const previousRendererSize = renderer.getSize(new THREE.Vector2());
      const previousPixelRatio = renderer.getPixelRatio();

      // --- Render at export resolution (synchronous) ---
      sourceCamera.aspect = targetWidth / targetHeight;
      sourceCamera.updateProjectionMatrix();

      if (activeOutlinePass) {
        const outUniforms = (activeOutlinePass as unknown as { uniforms?: Record<string, { value: number | THREE.Vector2 }> }).uniforms;
        if (outUniforms?.resolution) {
          (outUniforms.resolution.value as THREE.Vector2).set(targetWidth, targetHeight);
        }
      }

      renderer.setPixelRatio(1);
      renderer.setSize(targetWidth, targetHeight, false);
      composer.setSize(targetWidth, targetHeight);
      activeAoPass?.setSize(targetWidth, targetHeight);
      activeOutlinePass?.setSize(targetWidth, targetHeight);

      renderer.setRenderTarget(null);
      composer.render();

      // Read pixels synchronously before the browser paints the stretched frame.
      const gl = renderer.getContext();
      const pixels = new Uint8Array(targetWidth * targetHeight * 4);
      gl.readPixels(0, 0, targetWidth, targetHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

      // --- Restore viewport immediately (synchronous) ---
      sourceCamera.aspect = savedAspect;
      sourceCamera.updateProjectionMatrix();

      renderer.setPixelRatio(previousPixelRatio);
      renderer.setSize(previousRendererSize.x, previousRendererSize.y, false);
      composer.setSize(previousRendererSize.x, previousRendererSize.y);
      activeAoPass?.setSize(previousRendererSize.x, previousRendererSize.y);
      activeOutlinePass?.setSize(previousRendererSize.x, previousRendererSize.y);

      if (activeOutlinePass) {
        const outUniforms = (activeOutlinePass as unknown as { uniforms?: Record<string, { value: number | THREE.Vector2 }> }).uniforms;
        if (outUniforms?.resolution) {
          (outUniforms.resolution.value as THREE.Vector2).set(previousRendererSize.x, previousRendererSize.y);
        }
      }

      renderer.setRenderTarget(null);
      // Re-render at viewport size so the user sees export progress.
      composer.render();

      // --- Encode PNG asynchronously from the captured pixels ---
      const offCanvas = new OffscreenCanvas(targetWidth, targetHeight);
      const ctx2d = offCanvas.getContext('2d')!;
      const imageData = ctx2d.createImageData(targetWidth, targetHeight);
      // WebGL readPixels is bottom-to-top; flip for the canvas.
      for (let y = 0; y < targetHeight; y++) {
        const srcOff = (targetHeight - 1 - y) * targetWidth * 4;
        const dstOff = y * targetWidth * 4;
        imageData.data.set(pixels.subarray(srcOff, srcOff + targetWidth * 4), dstOff);
      }
      ctx2d.putImageData(imageData, 0, 0);

      return offCanvas.convertToBlob({ type: 'image/png' });
    };

    captureApiRef.current = { capturePngFrame, setPaused: (paused: boolean) => { pausedRef.current = paused; } };

    composerRef.current = composer;

    // Dark ground plane that receives shadows
    const floorMaterial = new THREE.MeshStandardMaterial({
      color: 0x15171a,
      roughness: 0.9,
      metalness: 0.05,
    });
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      floorMaterial,
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    workingFloorRef.current = ground;

    // Grid lines overlay — high-contrast, DCC-style
    const gridSize = 200;
    const gridDivisions = 100;
    const gridLineColor = new THREE.Color(0x3f434a);
    const gridCenterColor = new THREE.Color(0x8b8f97);

    const gridHelper = new THREE.GridHelper(gridSize, gridDivisions, gridCenterColor, gridLineColor);
    gridHelper.position.y = 0.005;
    (gridHelper.material as THREE.Material).transparent = true;
    (gridHelper.material as THREE.Material).opacity = 0.9;
    (gridHelper.material as THREE.Material).depthWrite = false;
    // Make grid lines visible from both sides (top and bottom)
    if (Array.isArray(gridHelper.material)) {
      gridHelper.material.forEach((m) => { m.side = THREE.DoubleSide; });
    } else {
      (gridHelper.material as THREE.Material).side = THREE.DoubleSide;
    }
    scene.add(gridHelper);
    checkerFloorRef.current = gridHelper as unknown as THREE.Mesh;
    checkerFloorMaterialRef.current = (
      Array.isArray(gridHelper.material) ? gridHelper.material[0] : gridHelper.material
    ) as THREE.MeshStandardMaterial;

    // Crop guide overlays (semi-transparent bars showing area outside export frame)
    const guideTop = document.createElement('div');
    const guideBottom = document.createElement('div');
    const guideLeft = document.createElement('div');
    const guideRight = document.createElement('div');
    const guideStyle = 'position:absolute;pointer-events:none;background:rgba(0,0,0,0.55);z-index:2;transition:all 0.15s ease;';
    [guideTop, guideBottom, guideLeft, guideRight].forEach((el) => {
      el.style.cssText = guideStyle;
      mount.appendChild(el);
    });

    const fitViewport = () => {
      const nextWidth = mount.clientWidth || window.innerWidth;
      const nextHeight = mount.clientHeight || window.innerHeight;
      const safeW = Math.max(nextWidth, 1);
      const safeH = Math.max(nextHeight, 1);
      const containerAspect = safeW / safeH;

      renderer.domElement.style.position = 'absolute';
      renderer.domElement.style.left = '0px';
      renderer.domElement.style.top = '0px';
      renderer.domElement.style.width = `${safeW}px`;
      renderer.domElement.style.height = `${safeH}px`;

      camera.aspect = containerAspect;
      camera.updateProjectionMatrix();

      const currentRenderCamera = renderPassRef.current?.camera;
      if (currentRenderCamera instanceof THREE.PerspectiveCamera) {
        currentRenderCamera.aspect = containerAspect;
        currentRenderCamera.updateProjectionMatrix();
      }

      renderer.setSize(safeW, safeH, false);
      composer.setSize(safeW, safeH);
      aoPassRef.current?.setSize(safeW, safeH);

      // Position crop guide overlays
      const hasGuide = previewAspect && Number.isFinite(previewAspect) && previewAspect > 0;
      if (hasGuide) {
        let boxW = safeW;
        let boxH = Math.round(safeW / previewAspect);
        if (boxH > safeH) {
          boxH = safeH;
          boxW = Math.round(safeH * previewAspect);
        }
        const oX = Math.round((safeW - boxW) / 2);
        const oY = Math.round((safeH - boxH) / 2);

        // Top bar
        guideTop.style.left = '0px'; guideTop.style.top = '0px';
        guideTop.style.width = `${safeW}px`; guideTop.style.height = `${oY}px`;
        guideTop.style.display = oY > 0 ? 'block' : 'none';
        // Bottom bar
        guideBottom.style.left = '0px'; guideBottom.style.top = `${oY + boxH}px`;
        guideBottom.style.width = `${safeW}px`; guideBottom.style.height = `${safeH - oY - boxH}px`;
        guideBottom.style.display = (safeH - oY - boxH) > 0 ? 'block' : 'none';
        // Left bar
        guideLeft.style.left = '0px'; guideLeft.style.top = `${oY}px`;
        guideLeft.style.width = `${oX}px`; guideLeft.style.height = `${boxH}px`;
        guideLeft.style.display = oX > 0 ? 'block' : 'none';
        // Right bar
        guideRight.style.left = `${oX + boxW}px`; guideRight.style.top = `${oY}px`;
        guideRight.style.width = `${safeW - oX - boxW}px`; guideRight.style.height = `${boxH}px`;
        guideRight.style.display = (safeW - oX - boxW) > 0 ? 'block' : 'none';
      } else {
        [guideTop, guideBottom, guideLeft, guideRight].forEach((el) => { el.style.display = 'none'; });
      }
    };

    fitViewportRef.current = fitViewport;

    window.addEventListener('resize', fitViewport);
    fitViewport();
    if (captureApiRef.current) {
      onSceneReady?.(scene, camera, controls, captureApiRef.current);
    }

    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      if (pausedRef.current) return;
      if (!activeCameraRef.current) {
        controls.update();
      }
      const fgUniforms = (filmGrainPassRef.current as unknown as { uniforms?: Record<string, { value: number }> })?.uniforms;
      if (fgUniforms?.time) {
        fgUniforms.time.value = performance.now() * 0.001;
      }
      composer.render();
    };

    animate();

    return () => {
      window.removeEventListener('resize', fitViewport);
      fitViewportRef.current = null;
      [guideTop, guideBottom, guideLeft, guideRight].forEach((el) => {
        if (mount.contains(el)) mount.removeChild(el);
      });

      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }

      controls.dispose();
      scene.environment = null;
      environmentTargetRef.current?.dispose();
      environmentTargetRef.current = null;
      pmremGeneratorRef.current?.dispose();
      pmremGeneratorRef.current = null;
      aoPassRef.current?.dispose();
      outputPassRef.current?.dispose();
      outputPassRef.current = null;
      composer.dispose();
      renderer.dispose();
      renderPassRef.current = null;
      colorGradingPassRef.current = null;
      bloomPassRef.current = null;
      bokehPassRef.current = null;
      aoPassRef.current = null;
      afterimagePassRef.current = null;
      outlinePassRef.current = null;
      vignettePassRef.current = null;
      glitchPassRef.current = null;
      brightnessContrastPassRef.current = null;
      toonPassRef.current = null;
      posterizePassRef.current = null;
      pixelatePassRef.current = null;
      chromaticAberrationPassRef.current = null;
      filmGrainPassRef.current = null;
      sharpenPassRef.current = null;
      sepiaPassRef.current = null;
      meshRimGlowPassRef.current = null;
      ambientLightRef.current = null;
      directionalLightRef.current = null;
      fillLightRef.current = null;
      rimLightRef.current = null;
      workingFloorRef.current = null;
      checkerFloorRef.current = null;
      checkerFloorMaterialRef.current = null;
      captureApiRef.current = null;

      if (mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, []);

  useEffect(() => {
    fitViewportRef.current?.();
  }, [previewAspect]);

  useEffect(() => {
    const renderPass = renderPassRef.current;
    const bokehPass = bokehPassRef.current;
    const aoPass = aoPassRef.current;
    const outlinePass = outlinePassRef.current;
    const fallbackCamera = cameraRef.current;
    const renderer = rendererRef.current;

    activeCameraRef.current = activeCamera;

    if (!renderPass || !fallbackCamera || !renderer) {
      return;
    }

    const nextCamera = activeCamera ?? fallbackCamera;
    const size = renderer.getSize(new THREE.Vector2());
    const nextAspect = size.x / Math.max(size.y, 1);
    nextCamera.aspect = nextAspect;
    nextCamera.updateProjectionMatrix();

    renderPass.camera = nextCamera;

    if (bokehPass) {
      bokehPass.camera = nextCamera;
    }

    if (aoPass) {
      aoPass.camera = nextCamera;
    }

    if (outlinePass) {
      const outUniforms = (outlinePass as unknown as { uniforms?: Record<string, { value: number | THREE.Vector2 }> }).uniforms;
      if (outUniforms?.resolution) {
        (outUniforms.resolution.value as THREE.Vector2).set(size.x, size.y);
      }
    }

    fitViewportRef.current?.();
  }, [activeCamera]);

  useEffect(() => {
    const scene = sceneRef.current;

    if (!scene) {
      return;
    }

    const characterGroups = new Set(characters.map((character) => character.group));

    characters.forEach((character) => {
      if (character.group.parent !== scene) {
        scene.add(character.group);
      }
    });

    // Remove any character groups that are no longer in the characters array
    const childrenToRemove = scene.children.filter((child) => 
      child.userData.__characterGroup && !characterGroups.has(child as THREE.Group)
    );

    childrenToRemove.forEach((child) => {
      scene.remove(child);
    });

    characters.forEach((character) => {
      character.group.userData.__characterGroup = true;
    });

    // Screen-space edge outline doesn't use selectedObjects like OutlinePass
    // It operates on the entire rendered frame via edge detection
  }, [characters]);

  useEffect(() => {
    const renderer = rendererRef.current;
    const bloomPass = bloomPassRef.current;
    const colorGradingPass = colorGradingPassRef.current;
    const bokehPass = bokehPassRef.current;
    const aoPass = aoPassRef.current;
    const afterimagePass = afterimagePassRef.current;
    const outlinePass = outlinePassRef.current;
    const vignettePass = vignettePassRef.current;
    const glitchPass = glitchPassRef.current;
    const brightnessContrastPass = brightnessContrastPassRef.current;
    const toonPass = toonPassRef.current;
    const posterizePass = posterizePassRef.current;
    const pixelatePass = pixelatePassRef.current;
    const chromaticAberrationPass = chromaticAberrationPassRef.current;
    const filmGrainPass = filmGrainPassRef.current;
    const sharpenPass = sharpenPassRef.current;
    const sepiaPass = sepiaPassRef.current;
    const meshRimGlowPass = meshRimGlowPassRef.current;
    const ambientLight = ambientLightRef.current;
    const directionalLight = directionalLightRef.current;
    const fillLight = fillLightRef.current;
    const rimLight = rimLightRef.current;
    const scene = sceneRef.current;
    const checkerMaterial = checkerFloorMaterialRef.current;

    if (
      !renderer ||
      !colorGradingPass ||
      !bloomPass ||
      !bokehPass ||
      !aoPass ||
      !afterimagePass ||
      !outlinePass ||
      !vignettePass ||
      !glitchPass ||
      !meshRimGlowPass ||
      !ambientLight ||
      !directionalLight
    ) {
      return;
    }

    const c = (v: number) => THREE.MathUtils.clamp(v, 0, 1);
    const clampedToneMapping = c(effects.toneMappingStrength);
    const clampedColorGrading = c(effects.colorGradingStrength);
    const clampedBrightnessContrast = c(effects.brightnessContrastStrength);
    const clampedBloom = c(effects.bloomStrength);
    const clampedDepthOfField = c(effects.depthOfFieldStrength);
    const clampedAo = c(effects.ambientOcclusionStrength);
    const clampedAfterimage = c(effects.afterimageStrength);
    const clampedGlitch = c(effects.glitchStrength);
    const clampedOutline = c(effects.outlineStrength);
    const clampedVignette = c(effects.vignetteStrength);
    const clampedMeshPhysical = c(effects.meshPhysicalStrength);
    const clampedMeshRimGlow = c(effects.meshRimGlowStrength);
    const clampedIblPortrait = c(effects.iblStudioPortraitStrength);
    const portraitMix = effects.iblStudioPortraitEnabled ? clampedIblPortrait : 0;
    const clampedToon = c(effects.toonShadingStrength);
    const clampedPosterize = c(effects.posterizeStrength);
    const clampedPixelate = c(effects.pixelateStrength);
    const clampedChromatic = c(effects.chromaticAberrationStrength);
    const clampedFilmGrain = c(effects.filmGrainStrength);
    const clampedSharpen = c(effects.sharpenStrength);
    const clampedSepia = c(effects.sepiaStrength);

    const gradingProfile = COLOR_GRADING_PROFILES[effects.colorGradingPreset] ?? COLOR_GRADING_PROFILES.cinematic;
    const glowProfile = BLOOM_PROFILES[effects.glowPreset] ?? BLOOM_PROFILES.studio;

    // --- Lighting & Tone ---
    const baseExposure = effects.toneMappingEnabled
      ? THREE.MathUtils.lerp(0.9, 1.35, clampedToneMapping)
      : 1;
    const gradingExposure = effects.colorGradingEnabled
      ? THREE.MathUtils.lerp(1, gradingProfile.exposure, clampedColorGrading)
      : 1;
    renderer.toneMappingExposure = baseExposure * gradingExposure;
    let dirInt = THREE.MathUtils.lerp(0.9, 1.15, clampedToneMapping);
    let ambInt = THREE.MathUtils.lerp(0.55, 0.78, clampedToneMapping);
    if (portraitMix > 0) {
      dirInt *= THREE.MathUtils.lerp(1, 0.84, portraitMix);
      ambInt *= THREE.MathUtils.lerp(1, 1.14, portraitMix);
    }
    directionalLight.intensity = dirInt;
    ambientLight.intensity = ambInt;
    directionalLight.shadow.radius = THREE.MathUtils.lerp(1, 5.2, portraitMix);
    if (fillLight) {
      fillLight.intensity = THREE.MathUtils.lerp(0.35, 0.58, portraitMix);
    }
    if (rimLight) {
      rimLight.intensity = THREE.MathUtils.lerp(0.3, 0.52, portraitMix);
    }
    if (scene) {
      scene.environmentIntensity = portraitMix > 0 ? THREE.MathUtils.lerp(1, 1.38, portraitMix) : 1;
    }

    colorGradingPass.enabled = effects.colorGradingEnabled;
    const gradingUniforms = (colorGradingPass as unknown as { uniforms?: Record<string, { value: number }> }).uniforms;
    if (gradingUniforms?.hue) {
      gradingUniforms.hue.value = effects.colorGradingEnabled
        ? THREE.MathUtils.lerp(0, gradingProfile.hue, clampedColorGrading)
        : 0;
    }
    if (gradingUniforms?.saturation) {
      gradingUniforms.saturation.value = effects.colorGradingEnabled
        ? THREE.MathUtils.lerp(0, gradingProfile.saturation, clampedColorGrading)
        : 0;
    }

    meshRimGlowPass.enabled = effects.meshRimGlowEnabled;
    const meshGlowUniforms = (meshRimGlowPass as unknown as { uniforms?: Record<string, { value: number | THREE.Vector2 | THREE.Vector3 }> }).uniforms;
    if (meshGlowUniforms?.resolution) {
      const rendererSize = renderer.getSize(new THREE.Vector2());
      const rw = Math.max(1, rendererSize.x);
      const rh = Math.max(1, rendererSize.y);
      (meshGlowUniforms.resolution.value as THREE.Vector2).set(rw, rh);
    }
    if (meshGlowUniforms?.strength) {
      meshGlowUniforms.strength.value = effects.meshRimGlowEnabled
        ? THREE.MathUtils.lerp(0.1, 0.82, clampedMeshRimGlow)
        : 0;
    }
    if (meshGlowUniforms?.radius) {
      meshGlowUniforms.radius.value = THREE.MathUtils.lerp(2.4, 8, clampedMeshRimGlow);
    }
    if (meshGlowUniforms?.edgeBias) {
      meshGlowUniforms.edgeBias.value = THREE.MathUtils.lerp(0.88, 1.25, clampedMeshRimGlow);
    }

    if (brightnessContrastPass) {
      brightnessContrastPass.enabled = effects.brightnessContrastEnabled;
      const bcUniforms = (brightnessContrastPass as unknown as { uniforms?: Record<string, { value: number }> }).uniforms;
      if (bcUniforms?.brightness) {
        bcUniforms.brightness.value = effects.brightnessContrastEnabled
          ? THREE.MathUtils.lerp(-0.05, 0.15, clampedBrightnessContrast)
          : 0;
      }
      if (bcUniforms?.contrast) {
        bcUniforms.contrast.value = effects.brightnessContrastEnabled
          ? THREE.MathUtils.lerp(0, 0.35, clampedBrightnessContrast)
          : 0;
      }
    }

    // --- Atmosphere ---
    bloomPass.enabled = effects.bloomEnabled;
    bloomPass.strength = effects.bloomEnabled
      ? THREE.MathUtils.lerp(glowProfile.minStrength, glowProfile.maxStrength, clampedBloom)
      : 0;
    bloomPass.radius = glowProfile.radius;
    bloomPass.threshold = glowProfile.threshold;

    bokehPass.enabled = effects.depthOfFieldEnabled;
    const bokehUniforms = (bokehPass as unknown as { materialBokeh?: { uniforms?: Record<string, { value: number }> } }).materialBokeh?.uniforms;
    if (bokehUniforms?.focus) {
      bokehUniforms.focus.value = DIFFUSION_PRESET.focus;
    }
    if (bokehUniforms?.maxblur) {
      bokehUniforms.maxblur.value = THREE.MathUtils.lerp(DIFFUSION_PRESET.maxblurMin, DIFFUSION_PRESET.maxblurMax, clampedDepthOfField);
    }
    if (bokehUniforms?.aperture) {
      bokehUniforms.aperture.value = THREE.MathUtils.lerp(DIFFUSION_PRESET.apertureMin, DIFFUSION_PRESET.apertureMax, clampedDepthOfField);
    }

    aoPass.enabled = effects.ambientOcclusionEnabled;
    aoPass.blendIntensity = effects.ambientOcclusionEnabled
      ? THREE.MathUtils.lerp(AO_PRESET.blendIntensityMin, AO_PRESET.blendIntensityMax, clampedAo)
      : 0;
    aoPass.updateGtaoMaterial({
      radius: THREE.MathUtils.lerp(AO_PRESET.radiusMin, AO_PRESET.radiusMax, clampedAo),
      thickness: THREE.MathUtils.lerp(AO_PRESET.thicknessMin, AO_PRESET.thicknessMax, clampedAo),
      scale: THREE.MathUtils.lerp(0.92, 1.08, clampedAo),
      samples: 16,
    });
    aoPass.updatePdMaterial({
      lumaPhi: THREE.MathUtils.lerp(10.0, 14.0, clampedAo),
      depthPhi: THREE.MathUtils.lerp(1.6, 2.4, clampedAo),
      normalPhi: THREE.MathUtils.lerp(2.8, 3.8, clampedAo),
      radius: THREE.MathUtils.lerp(6.0, 10.0, clampedAo),
    });

    vignettePass.enabled = effects.vignetteEnabled;
    const vignetteUniforms = (vignettePass as unknown as { uniforms?: Record<string, { value: number }> }).uniforms;
    if (vignetteUniforms?.offset) {
      vignetteUniforms.offset.value = THREE.MathUtils.lerp(0.9, 1.35, clampedVignette);
    }
    if (vignetteUniforms?.darkness) {
      vignetteUniforms.darkness.value = effects.vignetteEnabled
        ? THREE.MathUtils.lerp(0.5, 1.35, clampedVignette)
        : 0;
    }

    // --- Stylization ---
    if (toonPass) {
      toonPass.enabled = effects.toonShadingEnabled;
      const toonUniforms = (toonPass as unknown as { uniforms?: Record<string, { value: number }> }).uniforms;
      if (toonUniforms?.strength) {
        toonUniforms.strength.value = effects.toonShadingEnabled
          ? THREE.MathUtils.lerp(0.35, 1.0, clampedToon)
          : 0;
      }
      if (toonUniforms?.bands) {
        toonUniforms.bands.value = effects.toonShadingEnabled
          ? THREE.MathUtils.lerp(3.0, 5.0, clampedToon)
          : 4.0;
      }
      if (toonUniforms?.ditherAmount) {
        toonUniforms.ditherAmount.value = effects.toonShadingEnabled
          ? THREE.MathUtils.lerp(0.028, 0.055, clampedToon)
          : 0.04;
      }
    }

    // Screen-space edge outline uniforms (Genshin-style: thin soft dark lines)
    const outlineUniforms = (outlinePass as unknown as { uniforms?: Record<string, { value: number | THREE.Vector2 }> }).uniforms;
    if (outlineUniforms?.resolution) {
      const rendererSize = renderer.getSize(new THREE.Vector2());
      (outlineUniforms.resolution.value as THREE.Vector2).set(rendererSize.x, rendererSize.y);
    }
    if (outlineUniforms?.edgeStrength) {
      outlineUniforms.edgeStrength.value = effects.outlineEnabled
        ? THREE.MathUtils.lerp(0.8, 2.5, clampedOutline)
        : 0;
    }
    if (outlineUniforms?.threshold) {
      outlineUniforms.threshold.value = THREE.MathUtils.lerp(0.12, 0.04, clampedOutline);
    }
    if (outlineUniforms?.darkness) {
      outlineUniforms.darkness.value = THREE.MathUtils.lerp(0.4, 0.85, clampedOutline);
    }

    if (posterizePass) {
      posterizePass.enabled = effects.posterizeEnabled;
      const posterizeUniforms = (posterizePass as unknown as { uniforms?: Record<string, { value: number }> }).uniforms;
      if (posterizeUniforms?.levels) {
        posterizeUniforms.levels.value = effects.posterizeEnabled
          ? Math.round(THREE.MathUtils.lerp(16, 4, clampedPosterize))
          : 16;
      }
    }

    if (pixelatePass) {
      pixelatePass.enabled = effects.pixelateEnabled;
      const pixelateUniforms = (pixelatePass as unknown as { uniforms?: Record<string, { value: number | THREE.Vector2 }> }).uniforms;
      const rendererSize = renderer.getSize(new THREE.Vector2());
      if (pixelateUniforms?.resolution) {
        (pixelateUniforms.resolution.value as THREE.Vector2).set(rendererSize.x, rendererSize.y);
      }
      if (pixelateUniforms?.pixelSize) {
        pixelateUniforms.pixelSize.value = effects.pixelateEnabled
          ? Math.round(THREE.MathUtils.lerp(2, 12, clampedPixelate))
          : 1;
      }
    }

    // --- Motion & FX ---
    afterimagePass.enabled = effects.afterimageEnabled;
    const afterimageUniforms = (afterimagePass as unknown as { uniforms?: Record<string, { value: number }> }).uniforms;
    if (afterimageUniforms?.damp) {
      afterimageUniforms.damp.value = effects.afterimageEnabled
        ? THREE.MathUtils.lerp(0.78, 0.96, clampedAfterimage)
        : 0;
    }

    glitchPass.enabled = effects.glitchEnabled;
    glitchPass.goWild = clampedGlitch > 0.75;

    if (chromaticAberrationPass) {
      chromaticAberrationPass.enabled = effects.chromaticAberrationEnabled;
      const caUniforms = (chromaticAberrationPass as unknown as { uniforms?: Record<string, { value: number }> }).uniforms;
      if (caUniforms?.offset) {
        caUniforms.offset.value = effects.chromaticAberrationEnabled
          ? THREE.MathUtils.lerp(0.001, 0.015, clampedChromatic)
          : 0;
      }
    }

    if (filmGrainPass) {
      filmGrainPass.enabled = effects.filmGrainEnabled;
      const fgUniforms = (filmGrainPass as unknown as { uniforms?: Record<string, { value: number }> }).uniforms;
      if (fgUniforms?.amount) {
        fgUniforms.amount.value = effects.filmGrainEnabled
          ? THREE.MathUtils.lerp(0.02, 0.18, clampedFilmGrain)
          : 0;
      }
    }

    if (sharpenPass) {
      sharpenPass.enabled = effects.sharpenEnabled;
      const shUniforms = (sharpenPass as unknown as { uniforms?: Record<string, { value: number | THREE.Vector2 }> }).uniforms;
      const rendererSize = renderer.getSize(new THREE.Vector2());
      if (shUniforms?.resolution) {
        (shUniforms.resolution.value as THREE.Vector2).set(rendererSize.x, rendererSize.y);
      }
      if (shUniforms?.strength) {
        shUniforms.strength.value = effects.sharpenEnabled
          ? THREE.MathUtils.lerp(0.1, 0.8, clampedSharpen)
          : 0;
      }
    }

    if (sepiaPass) {
      sepiaPass.enabled = effects.sepiaEnabled;
      const sepiaUniforms = (sepiaPass as unknown as { uniforms?: Record<string, { value: number }> }).uniforms;
      if (sepiaUniforms?.amount) {
        sepiaUniforms.amount.value = effects.sepiaEnabled
          ? THREE.MathUtils.lerp(0.1, 1.0, clampedSepia)
          : 0;
      }
    }

    // --- Floor / Stage ---
    const currentWorkingFloor = workingFloorRef.current;
    const currentCheckerFloor = checkerFloorRef.current;
    if (currentWorkingFloor) {
      currentWorkingFloor.visible = defaultStageVisible;
    }
    if (currentCheckerFloor) {
      currentCheckerFloor.visible = defaultStageVisible;
    }

    // Stage materials: keep independent of screen-space AO. Tying roughness/metalness
    // or opacity to clampedAo made the whole scene read darker/more metallic whenever
    // the AO slider moved — unrelated to actual contact shadows.
    const baseFloorMaterial = currentWorkingFloor?.material;
    if (baseFloorMaterial instanceof THREE.MeshStandardMaterial) {
      baseFloorMaterial.roughness = 0.88;
      baseFloorMaterial.metalness = 0.12;
      baseFloorMaterial.color.setHex(0x252a36);
      baseFloorMaterial.needsUpdate = true;
    }

    if (checkerMaterial) {
      checkerMaterial.opacity = 0.58;
      checkerMaterial.needsUpdate = true;
    }

    // --- PBR (real MeshPhysicalMaterial + scene.environment IBL) on character roots only ---
    characters
      .filter((c) => c.type !== 'stage')
      .forEach((character) => {
        syncCharacterPhysicalMaterials(character.group, effects.meshPhysicalEnabled, clampedMeshPhysical);
        syncIblStudioPortraitMaterials(
          character.group,
          effects.iblStudioPortraitEnabled,
          effects.iblStudioPortraitEnabled ? clampedIblPortrait : 0,
        );
      });
  }, [effects, defaultStageVisible, characters]);

  useEffect(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;

    if (!camera || !controls) {
      return;
    }

    const loadedCharacters = characters.filter((character) => character.mesh && character.type !== 'stage');
    const frameKey = loadedCharacters.map((character) => `${character.id}:${character.mesh?.uuid ?? 'none'}`).join('|');

    if (!frameKey || frameKey === lastFramedKeyRef.current) {
      return;
    }

    const box = new THREE.Box3();
    loadedCharacters.forEach((character) => {
      box.expandByObject(character.group);
    });

    if (box.isEmpty()) {
      return;
    }

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const height = Math.max(size.y, 1);

    controls.target.copy(center);
    camera.position.set(center.x, center.y + height * 0.3, center.z + height * 1.5);
    camera.updateProjectionMatrix();
    controls.update();

    lastFramedKeyRef.current = frameKey;
  }, [characters]);

  useEffect(() => {
    if (sceneRef.current && cameraRef.current && controlsRef.current && captureApiRef.current) {
      onSceneReady?.(sceneRef.current, cameraRef.current, controlsRef.current, captureApiRef.current);
    }
  }, [onSceneReady]);

  return <div ref={mountRef} className={className ?? 'w-full h-full'} />;
};
