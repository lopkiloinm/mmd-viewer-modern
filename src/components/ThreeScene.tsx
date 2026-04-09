import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from '@three-jsm/controls/OrbitControls.js';
import { EffectComposer } from '@three-jsm/postprocessing/EffectComposer.js';
import { OutlinePass } from '@three-jsm/postprocessing/OutlinePass.js';
import { RenderPass } from '@three-jsm/postprocessing/RenderPass.js';
import { ShaderPass } from '@three-jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from '@three-jsm/postprocessing/UnrealBloomPass.js';
import { BokehPass } from '@three-jsm/postprocessing/BokehPass.js';
import { GTAOPass } from '@three-jsm/postprocessing/GTAOPass.js';
import { AfterimagePass } from '@three-jsm/postprocessing/AfterimagePass.js';
import { GlitchPass } from '@three-jsm/postprocessing/GlitchPass.js';
import { OutputPass } from '@three-jsm/postprocessing/OutputPass.js';
import { FXAAPass } from '@three-jsm/postprocessing/FXAAPass.js';
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
import { syncInvertedHullOutlines } from '../utils/invertedHullOutline';

type ColorGradingPreset = 'neutral' | 'cinematic' | 'anime' | 'cool' | 'warm';
type GlowPreset = 'studio' | 'soft' | 'neon' | 'dream';
type CharacterMaterialMode = 'physical' | 'standard' | 'phong' | 'lambert' | 'toon' | 'matcap' | 'clay';
type DepthOfFieldFocusTarget = 'pmx';

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
  /** Which character material model to generate when `meshPhysicalEnabled` is on. */
  characterMaterialMode: CharacterMaterialMode;
  /** Apply the same material swap to stage models (type=`stage`) + default floor plane. */
  stageMaterialEnabled: boolean;
  /** Soft rim / halo via three.js OutlinePass edge glow (mesh-selected, depth-based). */
  meshRimGlowEnabled: boolean;
  meshRimGlowStrength: number;
  /**
   * Scene rim directional light (real lighting, not post). When camera-aligned, it sits
   * behind the orbit target relative to the camera so silhouettes stay rim-lit while orbiting.
   */
  rimLightingEnabled: boolean;
  rimLightingStrength: number;
  rimLightingCameraAligned: boolean;
  /** Softer IBL-driven portrait lighting + optional diffusion hints on MeshPhysical (path-style offline look, real-time). */
  iblStudioPortraitEnabled: boolean;
  iblStudioPortraitStrength: number;
  // Atmosphere
  bloomEnabled: boolean;
  bloomStrength: number;
  glowPreset: GlowPreset;
  depthOfFieldEnabled: boolean;
  depthOfFieldStrength: number;
  /** DOF focus target. Currently only: full PMX bounds center. */
  depthOfFieldFocusTarget: DepthOfFieldFocusTarget;
  ambientOcclusionEnabled: boolean;
  ambientOcclusionStrength: number;
  vignetteEnabled: boolean;
  vignetteStrength: number;
  // Stylization
  toonShadingEnabled: boolean;
  toonShadingStrength: number;
  /** Mesh outline (three.js OutlinePass: depth compare + mask, industry-standard). */
  outlineEnabled: boolean;
  outlineStrength: number;
  /** Inverted-hull style rim: duplicate mesh, BackSide fill, slightly larger scale (skinning/morph-safe; no shader patch). */
  invertedHullOutlineEnabled: boolean;
  invertedHullOutlineStrength: number;
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
 * Lift-Gamma-Gain colour grading (industry standard: DaVinci Resolve / Nuke).
 * Operates in linear-light; the three controls adjust shadows (lift), mid-tones
 * (gamma), and highlights (gain) independently.  Combined with ACES this
 * preserves luminance structure so bloom / glow don't wash the grade out.
 */
const LiftGammaGainShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    lift: { value: new THREE.Vector3(0, 0, 0) },
    gamma: { value: new THREE.Vector3(1, 1, 1) },
    gain: { value: new THREE.Vector3(1, 1, 1) },
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
    uniform vec3 lift;
    uniform vec3 gamma;
    uniform vec3 gain;
    varying vec2 vUv;

    void main() {
      vec4 tex = texture2D(tDiffuse, vUv);
      // Lift adds to shadows, gain multiplies highlights, gamma curves mid-tones.
      vec3 c = tex.rgb;
      c = gain * (c + lift * (1.0 - c));
      // Safe pow: clamp to avoid NaN from negative bases.
      c = pow(max(c, 0.0), 1.0 / max(gamma, vec3(0.01)));
      gl_FragColor = vec4(c, tex.a);
    }
  `,
};

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
  characterMaterialMode: 'physical',
  stageMaterialEnabled: false,
  meshRimGlowEnabled: false,
  meshRimGlowStrength: 0.4,
  rimLightingEnabled: true,
  rimLightingStrength: 0.35,
  rimLightingCameraAligned: true,
  iblStudioPortraitEnabled: false,
  iblStudioPortraitStrength: 0.45,
  bloomEnabled: true,
  bloomStrength: 0.22,
  glowPreset: 'studio',
  depthOfFieldEnabled: false,
  depthOfFieldStrength: 0.25,
  depthOfFieldFocusTarget: 'pmx',
  ambientOcclusionEnabled: true,
  ambientOcclusionStrength: 0.38,
  vignetteEnabled: false,
  vignetteStrength: 0.35,
  toonShadingEnabled: false,
  toonShadingStrength: 0.5,
  outlineEnabled: false,
  outlineStrength: 0.4,
  invertedHullOutlineEnabled: false,
  invertedHullOutlineStrength: 0.35,
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
  neutral:   { hue: 0,      saturation: 0.03,  exposure: 1.0  },
  cinematic: { hue: -0.008, saturation: 0.18,  exposure: 0.96 },
  anime:     { hue: 0.012,  saturation: 0.25,  exposure: 1.0  },
  cool:      { hue: -0.02,  saturation: 0.14,  exposure: 0.95 },
  warm:      { hue: 0.015,  saturation: 0.16,  exposure: 0.98 },
};

const BLOOM_PROFILES: Record<GlowPreset, { threshold: number; radius: number; minStrength: number; maxStrength: number }> = {
  // High thresholds: bloom catches only specular highlights / emissive, not mid-tones.
  studio: { threshold: 0.94, radius: 0.25, minStrength: 0.06, maxStrength: 0.55 },
  soft:   { threshold: 0.97, radius: 0.38, minStrength: 0.04, maxStrength: 0.42 },
  neon:   { threshold: 0.88, radius: 0.22, minStrength: 0.10, maxStrength: 0.85 },
  dream:  { threshold: 0.92, radius: 0.48, minStrength: 0.08, maxStrength: 0.65 },
};

const DIFFUSION_PRESET = {
  focus: 1.0,
  maxblurMin: 0.001,
  maxblurMax: 0.015,
  apertureMin: 0.00001,
  apertureMax: 0.00008,
};

/** GTAO + Poisson denoise — archviz contact shadows only, not global darkening. */
const AO_PRESET = {
  blendIntensityMin: 0.12,
  blendIntensityMax: 0.48,
  radiusMin: 0.08,
  radiusMax: 0.28,
  thicknessMin: 0.55,
  thicknessMax: 1.1,
};

const RIM_LIGHT_ALIGN = {
  distance: 85,
  /** Matches previous portrait-off / portrait-on intensity ratio. */
  portraitBoost: 1.73,
};

const _rimFrameScratch = {
  target: new THREE.Vector3(),
  toCam: new THREE.Vector3(),
};

const _cameraTranslationScratch = new THREE.Vector3();
const _dofBoxScratch = new THREE.Box3();
const _dofCenterScratch = new THREE.Vector3();

function applyMmdCameraTranslationToPosition(
  useTranslation: boolean,
  cam: THREE.Camera | null,
  t: CameraTranslationOffset,
): void {
  if (!useTranslation || !cam) return;
  _cameraTranslationScratch.set(t.x, t.y, t.z);
  cam.position.add(_cameraTranslationScratch);
}

function undoMmdCameraTranslationFromPosition(
  useTranslation: boolean,
  cam: THREE.Camera | null,
  t: CameraTranslationOffset,
): void {
  if (!useTranslation || !cam) return;
  _cameraTranslationScratch.set(t.x, t.y, t.z);
  cam.position.sub(_cameraTranslationScratch);
}

/** World-space offset added to the active render camera each frame (after OrbitControls / VMD pose). */
export interface CameraTranslationOffset {
  x: number;
  y: number;
  z: number;
}

const defaultCameraTranslation: CameraTranslationOffset = { x: 0, y: 0, z: 0 };

interface ThreeSceneProps {
  className?: string;
  characters?: Character[];
  activeCamera?: THREE.PerspectiveCamera | null;
  effects?: ViewportEffects;
  /** Added to the current view camera position every frame only; orbit target and VMD motion stay unchanged. */
  cameraTranslation?: CameraTranslationOffset;
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
  cameraTranslation = defaultCameraTranslation,
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
  const vignettePassRef = useRef<ShaderPass | null>(null);
  const glitchPassRef = useRef<GlitchPass | null>(null);
  const outputPassRef = useRef<OutputPass | null>(null);
  const fxaaPassRef = useRef<FXAAPass | null>(null);
  const brightnessContrastPassRef = useRef<ShaderPass | null>(null);
  const toonPassRef = useRef<ShaderPass | null>(null);
  const posterizePassRef = useRef<ShaderPass | null>(null);
  const pixelatePassRef = useRef<ShaderPass | null>(null);
  const chromaticAberrationPassRef = useRef<ShaderPass | null>(null);
  const filmGrainPassRef = useRef<ShaderPass | null>(null);
  const sharpenPassRef = useRef<ShaderPass | null>(null);
  const sepiaPassRef = useRef<ShaderPass | null>(null);
  const liftGammaGainPassRef = useRef<ShaderPass | null>(null);
  const ambientLightRef = useRef<THREE.AmbientLight | null>(null);
  const directionalLightRef = useRef<THREE.DirectionalLight | null>(null);
  const fillLightRef = useRef<THREE.DirectionalLight | null>(null);
  const rimLightRef = useRef<THREE.DirectionalLight | null>(null);
  const outlinePassRef = useRef<OutlinePass | null>(null);
  const workingFloorRef = useRef<THREE.Mesh | null>(null);
  const checkerFloorRef = useRef<THREE.Mesh | null>(null);
  const checkerFloorMaterialRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const pmremGeneratorRef = useRef<THREE.PMREMGenerator | null>(null);
  const environmentTargetRef = useRef<THREE.WebGLRenderTarget | null>(null);
  const captureApiRef = useRef<ThreeSceneCaptureApi | null>(null);
  const activeCameraRef = useRef<THREE.PerspectiveCamera | null>(activeCamera);
  const viewportEffectsRef = useRef<ViewportEffects>(effects);
  const cameraTranslationRef = useRef<CameraTranslationOffset>(cameraTranslation);
  /** Last cameraTranslation values baked into orbit camera + target (orbit mode only). */
  const lastBakedCameraTranslationRef = useRef<CameraTranslationOffset>({ ...cameraTranslation });
  const frameRef = useRef<number | null>(null);
  const lastFramedKeyRef = useRef('');
  const pausedRef = useRef(false);
  const fitViewportRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    viewportEffectsRef.current = effects;
  }, [effects]);

  useEffect(() => {
    cameraTranslationRef.current = cameraTranslation;
  }, [cameraTranslation]);

  /** When the view camera source changes, realign bookkeeping so we don’t apply a bogus delta. */
  useEffect(() => {
    lastBakedCameraTranslationRef.current = {
      x: cameraTranslation.x,
      y: cameraTranslation.y,
      z: cameraTranslation.z,
    };
  }, [activeCamera]);

  /**
   * Orbit view: bake translation when sliders change (move camera + target together — one delta per change).
   * VMD camera: motion resets pose every frame; offset is reapplied in the animation loop instead.
   */
  useEffect(() => {
    if (activeCamera) {
      return;
    }
    const cam = cameraRef.current;
    const ctrl = controlsRef.current;
    if (!cam || !ctrl) {
      return;
    }
    const prev = lastBakedCameraTranslationRef.current;
    const cur = cameraTranslation;
    const dx = cur.x - prev.x;
    const dy = cur.y - prev.y;
    const dz = cur.z - prev.z;
    if (dx === 0 && dy === 0 && dz === 0) {
      return;
    }
    cam.position.x += dx;
    cam.position.y += dy;
    cam.position.z += dz;
    ctrl.target.x += dx;
    ctrl.target.y += dy;
    ctrl.target.z += dz;
    lastBakedCameraTranslationRef.current = { x: cur.x, y: cur.y, z: cur.z };
  }, [cameraTranslation, activeCamera]);

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

    // MSAA applies to the default framebuffer; EffectComposer renders to offscreen targets, so
    // post-process AA is handled by FXAAPass after OutputPass (see below).
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
    const roomEnvironment = new RoomEnvironment();
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
    scene.add(rimLight.target);
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

    /** Lift-Gamma-Gain: archviz colour grading that preserves luminance under bloom. */
    const liftGammaGainPass = new ShaderPass(LiftGammaGainShader);
    liftGammaGainPass.enabled = true;
    composer.addPass(liftGammaGainPass);
    liftGammaGainPassRef.current = liftGammaGainPass;

    /**
     * three.js OutlinePass: selected-mesh mask + depth compare + blur + additive composite (canonical mesh outline).
     * Runs immediately before OutputPass so edges are tone-mapped with the frame.
     */
    const outlinePass = new OutlinePass(new THREE.Vector2(width, height), scene, camera, []);
    outlinePass.enabled = false;
    outlinePass.edgeStrength = 2.2;
    outlinePass.edgeThickness = 1.15;
    outlinePass.edgeGlow = 0.5;
    outlinePass.visibleEdgeColor.set(0.08, 0.09, 0.14);
    outlinePass.hiddenEdgeColor.set(0.05, 0.05, 0.08);
    composer.addPass(outlinePass);
    outlinePassRef.current = outlinePass;

    /** Tone-mapped sRGB output (linear HDR → display). */
    const outputPass = new OutputPass();
    outputPass.enabled = true;
    composer.addPass(outputPass);
    outputPassRef.current = outputPass;

    /** FXAA on the final image — composer RTs are not MSAA-sampled, so this is the main edge AA. */
    const fxaaPass = new FXAAPass();
    fxaaPass.setSize(width, height);
    composer.addPass(fxaaPass);
    fxaaPassRef.current = fxaaPass;

    const capturePngFrame = async (frameWidth: number, frameHeight: number) => {
      const targetWidth = Math.max(2, Math.round(frameWidth));
      const targetHeight = Math.max(2, Math.round(frameHeight));

      const activeRenderPass = renderPassRef.current;
      if (!activeRenderPass) {
        throw new Error('Render pass is unavailable.');
      }

      const activeAoPass = aoPassRef.current;
      const activeOutlinePass = outlinePassRef.current;
      const activeFxaaPass = fxaaPassRef.current;
      const activeBloomPass = bloomPassRef.current;
      const activeBokehPass = bokehPassRef.current;
      const scene = sceneRef.current;

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

      renderer.setPixelRatio(1);
      renderer.setSize(targetWidth, targetHeight, false);
      composer.setSize(targetWidth, targetHeight);
      activeAoPass?.setSize(targetWidth, targetHeight);
      activeOutlinePass?.setSize(targetWidth, targetHeight);
      activeFxaaPass?.setSize(targetWidth, targetHeight);
      activeBloomPass?.setSize(targetWidth, targetHeight);
      activeBokehPass?.setSize(targetWidth, targetHeight);

      renderer.setRenderTarget(null);
      const mmdViewActive = activeCameraRef.current !== null;
      const camTrans = cameraTranslationRef.current;
      applyMmdCameraTranslationToPosition(mmdViewActive, sourceCamera, camTrans);

      // When export pauses the main render loop, camera/character poses can still change per frame
      // (seek/update in the export loop). Update DOF focus here so exports match the viewport.
      if (
        activeBokehPass &&
        activeBokehPass.enabled &&
        viewportEffectsRef.current.depthOfFieldEnabled &&
        viewportEffectsRef.current.depthOfFieldFocusTarget === 'pmx' &&
        scene
      ) {
        _dofBoxScratch.makeEmpty();
        scene.children.forEach((child) => {
          if (child.userData.__characterGroup) {
            _dofBoxScratch.expandByObject(child);
          }
        });
        if (!_dofBoxScratch.isEmpty()) {
          _dofBoxScratch.getCenter(_dofCenterScratch);
          const uniforms = (activeBokehPass as unknown as { uniforms?: Record<string, { value: number }> }).uniforms;
          if (uniforms?.focus) {
            uniforms.focus.value = sourceCamera.position.distanceTo(_dofCenterScratch);
          }
        }
      }

      composer.render();

      // Read pixels synchronously before the browser paints the stretched frame.
      const gl = renderer.getContext();
      const pixels = new Uint8Array(targetWidth * targetHeight * 4);
      gl.readPixels(0, 0, targetWidth, targetHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

      undoMmdCameraTranslationFromPosition(mmdViewActive, sourceCamera, camTrans);

      // --- Restore viewport immediately (synchronous) ---
      sourceCamera.aspect = savedAspect;
      sourceCamera.updateProjectionMatrix();

      renderer.setPixelRatio(previousPixelRatio);
      renderer.setSize(previousRendererSize.x, previousRendererSize.y, false);
      composer.setSize(previousRendererSize.x, previousRendererSize.y);
      activeAoPass?.setSize(previousRendererSize.x, previousRendererSize.y);
      activeOutlinePass?.setSize(previousRendererSize.x, previousRendererSize.y);
      activeFxaaPass?.setSize(previousRendererSize.x, previousRendererSize.y);
      activeBloomPass?.setSize(previousRendererSize.x, previousRendererSize.y);
      activeBokehPass?.setSize(previousRendererSize.x, previousRendererSize.y);

      renderer.setRenderTarget(null);
      applyMmdCameraTranslationToPosition(mmdViewActive, sourceCamera, camTrans);
      // Re-render at viewport size so the user sees export progress.
      composer.render();
      undoMmdCameraTranslationFromPosition(mmdViewActive, sourceCamera, camTrans);

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
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
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
    const gridDivisions = 50;
    const gridLineColor = new THREE.Color(0x3f434a);
    const gridCenterColor = new THREE.Color(0x8b8f97);

    const gridHelper = new THREE.GridHelper(gridSize, gridDivisions, gridCenterColor, gridLineColor);
    gridHelper.position.y = 0.01;
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
      fxaaPassRef.current?.setSize(safeW, safeH);
      bloomPassRef.current?.setSize(safeW, safeH);
      bokehPassRef.current?.setSize(safeW, safeH);
      outlinePassRef.current?.setSize(safeW, safeH);

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
      const paused = pausedRef.current;

      // While paused (e.g. PNG export), skip advancing orbit / time-based FX, but keep drawing so
      // slider bakes (orbit) and VMD translation still show, matching capturePngFrame.
      if (!paused) {
        if (!activeCameraRef.current) {
          controls.update();
        }
      }

      const renderCam = renderPassRef.current?.camera ?? cameraRef.current;
      // Orbit: translation is baked when sliders change (useEffect). VMD: pose is overwritten by motion each frame.
      if (activeCameraRef.current && renderCam) {
        applyMmdCameraTranslationToPosition(true, renderCam, cameraTranslationRef.current);
      }

      const fx = viewportEffectsRef.current;
      const rim = rimLightRef.current;
      if (rim && fx.rimLightingEnabled && fx.rimLightingCameraAligned && renderCam) {
        const target = _rimFrameScratch.target;
        target.copy(controls.target);
        _rimFrameScratch.toCam.subVectors(renderCam.position, target);
        if (_rimFrameScratch.toCam.lengthSq() < 1e-8) {
          _rimFrameScratch.toCam.set(0, 0, 1);
        } else {
          _rimFrameScratch.toCam.normalize();
        }
        rim.position.copy(target).addScaledVector(_rimFrameScratch.toCam, -RIM_LIGHT_ALIGN.distance);
        rim.target.position.copy(target);
        rim.target.updateMatrixWorld();
      }

      if (!paused) {
        const fgUniforms = (filmGrainPassRef.current as unknown as { uniforms?: Record<string, { value: number }> })?.uniforms;
        if (fgUniforms?.time) {
          fgUniforms.time.value = performance.now() * 0.001;
        }
      }
      composer.render();

      if (activeCameraRef.current && renderCam) {
        undoMmdCameraTranslationFromPosition(true, renderCam, cameraTranslationRef.current);
      }
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
      fxaaPassRef.current = null;
      composer.dispose();
      renderer.dispose();
      renderPassRef.current = null;
      colorGradingPassRef.current = null;
      bloomPassRef.current = null;
      bokehPassRef.current = null;
      aoPassRef.current = null;
      afterimagePassRef.current = null;
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
      liftGammaGainPassRef.current = null;
      outlinePassRef.current?.dispose();
      outlinePassRef.current = null;
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
    const outlinePassCam = outlinePassRef.current;
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

    if (outlinePassCam) {
      outlinePassCam.renderCamera = nextCamera;
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

  }, [characters]);

  useEffect(() => {
    const renderer = rendererRef.current;
    const bloomPass = bloomPassRef.current;
    const colorGradingPass = colorGradingPassRef.current;
    const bokehPass = bokehPassRef.current;
    const aoPass = aoPassRef.current;
    const afterimagePass = afterimagePassRef.current;
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
    const outlinePass = outlinePassRef.current;
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
      !vignettePass ||
      !glitchPass ||
      !outlinePass ||
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
    const clampedInvertedHull = c(effects.invertedHullOutlineStrength);
    const clampedVignette = c(effects.vignetteStrength);
    const clampedMeshPhysical = c(effects.meshPhysicalStrength);
    const clampedMeshRimGlow = c(effects.meshRimGlowStrength);
    const clampedRimLighting = c(effects.rimLightingStrength);
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
      ? THREE.MathUtils.lerp(0.9, 1.15, clampedToneMapping)
      : 1;
    const gradingExposure = effects.colorGradingEnabled
      ? THREE.MathUtils.lerp(1, gradingProfile.exposure, clampedColorGrading)
      : 1;
    // Bloom adds energy (additive blend); compensate exposure so the combined
    // image doesn't wash out.  The stronger the bloom, the more we pull back.
    const bloomCompensation = effects.bloomEnabled
      ? THREE.MathUtils.lerp(1.0, 0.88, clampedBloom)
      : 1;
    renderer.toneMappingExposure = baseExposure * gradingExposure * bloomCompensation;
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
      const rimBase = effects.rimLightingEnabled
        ? THREE.MathUtils.lerp(0.1, 0.65, clampedRimLighting)
        : 0;
      rimLight.intensity = THREE.MathUtils.lerp(rimBase, rimBase * RIM_LIGHT_ALIGN.portraitBoost, portraitMix);
      if (!effects.rimLightingCameraAligned) {
        rimLight.position.set(0, 15, -15);
        rimLight.target.position.set(0, 0, 0);
        rimLight.target.updateMatrixWorld();
      }
    }
    if (scene) {
      scene.environmentIntensity = portraitMix > 0 ? THREE.MathUtils.lerp(1, 1.25, portraitMix) : 1;
    }

    colorGradingPass.enabled = effects.colorGradingEnabled;
    const gradingUniforms = (colorGradingPass as unknown as { uniforms?: Record<string, { value: number }> }).uniforms;
    if (gradingUniforms?.hue) {
      gradingUniforms.hue.value = effects.colorGradingEnabled
        ? THREE.MathUtils.lerp(0, gradingProfile.hue, clampedColorGrading)
        : 0;
    }
    if (gradingUniforms?.saturation) {
      // Pull saturation back when bloom is active — bloom adds luminance which
      // can push saturated tones into garish territory.
      const satCeil = effects.bloomEnabled
        ? gradingProfile.saturation * THREE.MathUtils.lerp(1, 0.7, clampedBloom)
        : gradingProfile.saturation;
      gradingUniforms.saturation.value = effects.colorGradingEnabled
        ? THREE.MathUtils.lerp(0, satCeil, clampedColorGrading)
        : 0;
    }

    // Lift-Gamma-Gain: archviz colour grading that preserves luminance under bloom
    const lggPass = liftGammaGainPassRef.current;
    if (lggPass) {
      const lggUniforms = (lggPass as unknown as { uniforms?: Record<string, { value: THREE.Vector3 }> }).uniforms;
      if (lggUniforms?.lift && lggUniforms?.gamma && lggUniforms?.gain) {
        if (effects.colorGradingEnabled) {
          // Lift: subtle shadow tint (cool blue for cinematic feel)
          const liftTint = THREE.MathUtils.lerp(0, -0.015, clampedColorGrading);
          lggUniforms.lift.value.set(liftTint, liftTint, liftTint + 0.005);
          // Gamma: midtone curve (slight contrast boost)
          const gammaCurve = THREE.MathUtils.lerp(1.0, 0.95, clampedColorGrading);
          lggUniforms.gamma.value.set(gammaCurve, gammaCurve, gammaCurve);
          // Gain: highlight tint (warm for cinematic feel)
          const gainTint = THREE.MathUtils.lerp(1.0, 1.02, clampedColorGrading);
          lggUniforms.gain.value.set(gainTint, gainTint, gainTint);
        } else {
          lggUniforms.lift.value.set(0, 0, 0);
          lggUniforms.gamma.value.set(1, 1, 1);
          lggUniforms.gain.value.set(1, 1, 1);
        }
      }
    }

    const outlineTargets = characters
      .filter((ch) => ch.type !== 'stage')
      .map((ch) => ch.group);
    outlinePass.selectedObjects = outlineTargets;

    const wantOutlineFx = effects.outlineEnabled || effects.meshRimGlowEnabled;
    outlinePass.enabled = wantOutlineFx && outlineTargets.length > 0;
    if (wantOutlineFx && outlineTargets.length > 0) {
      const ink = clampedOutline;
      const glow = clampedMeshRimGlow;
      outlinePass.edgeThickness = THREE.MathUtils.lerp(0.85, 2.1, ink);
      outlinePass.edgeStrength = THREE.MathUtils.lerp(1.4, 4.2, Math.max(ink, glow * 0.65));

      if (effects.outlineEnabled && effects.meshRimGlowEnabled) {
        outlinePass.visibleEdgeColor.setRGB(0.1, 0.11, 0.18);
        outlinePass.hiddenEdgeColor.setRGB(0.06, 0.06, 0.09);
        outlinePass.edgeGlow = THREE.MathUtils.lerp(0.35, 2.0, glow);
      } else if (effects.outlineEnabled) {
        outlinePass.visibleEdgeColor.setRGB(0.06, 0.065, 0.1);
        outlinePass.hiddenEdgeColor.setRGB(0.035, 0.035, 0.05);
        outlinePass.edgeGlow = THREE.MathUtils.lerp(0.0, 0.45, ink);
      } else {
        outlinePass.visibleEdgeColor.setRGB(0.42, 0.55, 0.95);
        outlinePass.hiddenEdgeColor.setRGB(0.15, 0.2, 0.35);
        outlinePass.edgeGlow = THREE.MathUtils.lerp(0.75, 3.0, glow);
      }
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
    const isSwapMode = effects.meshPhysicalEnabled && effects.characterMaterialMode !== 'toon';
    // PBR materials produce brighter specular peaks → reduce bloom strength moderately
    // to prevent flooding while maintaining fill light from glow.
    const bloomAttenuation = isSwapMode ? THREE.MathUtils.lerp(0.7, 0.4, clampedMeshPhysical) : 1;
    bloomPass.strength = effects.bloomEnabled
      ? THREE.MathUtils.lerp(glowProfile.minStrength, glowProfile.maxStrength, clampedBloom) * bloomAttenuation
      : 0;
    bloomPass.radius = isSwapMode ? Math.min(glowProfile.radius, 0.35) : glowProfile.radius;
    // In swap modes, highlights are more physically plausible (and brighter), so require a higher threshold.
    bloomPass.threshold = isSwapMode
      ? Math.max(glowProfile.threshold, 0.92) + 0.04
      : glowProfile.threshold;

    bokehPass.enabled = effects.depthOfFieldEnabled;
    const bokehUniforms = (bokehPass as unknown as { materialBokeh?: { uniforms?: Record<string, { value: number }> } }).materialBokeh?.uniforms;
    if (bokehUniforms?.focus) {
      let focus = DIFFUSION_PRESET.focus;
      if (effects.depthOfFieldEnabled && effects.depthOfFieldFocusTarget === 'pmx') {
        const renderCam = (renderPassRef.current?.camera ?? cameraRef.current) as THREE.Camera | null;
        if (!renderCam) {
          // No camera available; keep default focus.
          bokehUniforms.focus.value = focus;
          return;
        }
        _dofBoxScratch.makeEmpty();
        characters
          .filter((ch) => ch.type !== 'stage')
          .forEach((ch) => {
            _dofBoxScratch.expandByObject(ch.group);
          });
        if (!_dofBoxScratch.isEmpty()) {
          _dofBoxScratch.getCenter(_dofCenterScratch);
          focus = renderCam.position.distanceTo(_dofCenterScratch);
        }
      }
      bokehUniforms.focus.value = focus;
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

    // --- Material swaps ---
    const wantCharacterMaterialSwap = effects.meshPhysicalEnabled;
    const wantStageMaterialSwap = effects.meshPhysicalEnabled && effects.stageMaterialEnabled;

    // Default ground plane: apply stage swap (opt-in only)
    if (workingFloorRef.current) {
      syncCharacterPhysicalMaterials(
        workingFloorRef.current,
        wantStageMaterialSwap,
        clampedMeshPhysical,
        effects.characterMaterialMode,
      );
    }

    // Stage models: apply stage swap (opt-in only)
    characters
      .filter((c) => c.type === 'stage')
      .forEach((character) => {
        syncCharacterPhysicalMaterials(
          character.group,
          wantStageMaterialSwap,
          clampedMeshPhysical,
          effects.characterMaterialMode,
        );
        syncIblStudioPortraitMaterials(
          character.group,
          wantStageMaterialSwap && effects.iblStudioPortraitEnabled && effects.characterMaterialMode === 'physical',
          wantStageMaterialSwap && effects.iblStudioPortraitEnabled && effects.characterMaterialMode === 'physical'
            ? clampedIblPortrait
            : 0,
        );
      });

    // Character models: always follow `meshPhysicalEnabled`
    characters
      .filter((c) => c.type !== 'stage')
      .forEach((character) => {
        syncCharacterPhysicalMaterials(
          character.group,
          wantCharacterMaterialSwap,
          clampedMeshPhysical,
          effects.characterMaterialMode,
        );
        syncIblStudioPortraitMaterials(
          character.group,
          wantCharacterMaterialSwap && effects.iblStudioPortraitEnabled && effects.characterMaterialMode === 'physical',
          wantCharacterMaterialSwap && effects.iblStudioPortraitEnabled && effects.characterMaterialMode === 'physical'
            ? clampedIblPortrait
            : 0,
        );
      });

    characters.forEach((character) => {
      const wantHull = effects.invertedHullOutlineEnabled && character.type !== 'stage';
      syncInvertedHullOutlines(
        character.group,
        wantHull,
        wantHull ? THREE.MathUtils.lerp(0.002, 0.025, clampedInvertedHull) : 0,
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
