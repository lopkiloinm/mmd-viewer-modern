import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { AfterimagePass } from 'three/examples/jsm/postprocessing/AfterimagePass.js';
import { GlitchPass } from 'three/examples/jsm/postprocessing/GlitchPass.js';
import { HueSaturationShader } from 'three/examples/jsm/shaders/HueSaturationShader.js';
import { VignetteShader } from 'three/examples/jsm/shaders/VignetteShader.js';
import { BrightnessContrastShader } from 'three/examples/jsm/shaders/BrightnessContrastShader.js';
import { SepiaShader } from 'three/examples/jsm/shaders/SepiaShader.js';
import { type Character } from '../hooks/useModelLoader';

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
  // Material Enhancement
  principledEnabled: boolean;
  principledStrength: number;
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

const ToonQuantizeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    strength: { value: 0.5 },
    shadowThreshold: { value: 0.35 },
    midThreshold: { value: 0.65 },
    shadowTint: { value: new THREE.Vector3(0.85, 0.78, 0.95) },
    shadowDarken: { value: 0.62 },
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
    uniform float shadowThreshold;
    uniform float midThreshold;
    uniform vec3 shadowTint;
    uniform float shadowDarken;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      float lum = dot(color.rgb, vec3(0.299, 0.587, 0.114));

      // Smooth S-curve contrast remap — no discrete bands, no visible edges
      // Sigmoid pushes darks darker and lights brighter without band artifacts
      float centered = (lum - shadowThreshold) / max(midThreshold - shadowThreshold, 0.01);
      float curved = 1.0 / (1.0 + exp(-4.0 * (centered - 0.5)));

      // Shadow tinting: blend toward cooler shadow color in dark regions
      float shadowMix = 1.0 - smoothstep(0.0, 0.6, curved);
      vec3 tinted = mix(color.rgb, color.rgb * shadowTint, shadowMix);

      // Apply darkening curve: remap brightness via the sigmoid
      float darkenFactor = mix(shadowDarken, 1.05, curved);
      vec3 toonColor = tinted * darkenFactor;

      gl_FragColor = vec4(mix(color.rgb, toonColor, strength), color.a);
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
      color.rgb = floor(color.rgb * levels + 0.5) / levels;
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
  principledEnabled: false,
  principledStrength: 0.45,
  bloomEnabled: true,
  bloomStrength: 0.22,
  glowPreset: 'studio',
  depthOfFieldEnabled: false,
  depthOfFieldStrength: 0.25,
  ambientOcclusionEnabled: true,
  ambientOcclusionStrength: 0.45,
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

const AO_PRESET = {
  kernelRadiusMin: 6,
  kernelRadiusMax: 24,
  minDistanceMin: 0.003,
  minDistanceMax: 0.016,
  maxDistanceMin: 0.08,
  maxDistanceMax: 0.28,
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

interface SavedMaterialProps {
  roughness?: number;
  metalness?: number;
  envMapIntensity?: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  sheen?: number;
  sheenRoughness?: number;
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
  const ssaoPassRef = useRef<SSAOPass | null>(null);
  const afterimagePassRef = useRef<AfterimagePass | null>(null);
  const outlinePassRef = useRef<ShaderPass | null>(null);
  const vignettePassRef = useRef<ShaderPass | null>(null);
  const glitchPassRef = useRef<GlitchPass | null>(null);
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
  const workingFloorRef = useRef<THREE.Mesh | null>(null);
  const checkerFloorRef = useRef<THREE.Mesh | null>(null);
  const checkerFloorMaterialRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const materialBasePropsRef = useRef<WeakMap<THREE.Material, SavedMaterialProps>>(new WeakMap());
  const captureApiRef = useRef<ThreeSceneCaptureApi | null>(null);
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

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    rendererRef.current = renderer;
    mount.appendChild(renderer.domElement);

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
    scene.add(directionalLight);
    directionalLightRef.current = directionalLight;

    const fillLight = new THREE.DirectionalLight(0x8888ff, 0.35);
    fillLight.position.set(-10, 10, -5);
    scene.add(fillLight);

    const backLight = new THREE.DirectionalLight(0xffaa44, 0.3);
    backLight.position.set(0, 15, -15);
    scene.add(backLight);

    const composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    renderPassRef.current = renderPass;
    composer.addPass(renderPass);

    const colorGradingPass = new ShaderPass(HueSaturationShader);
    colorGradingPass.enabled = true;
    composer.addPass(colorGradingPass);
    colorGradingPassRef.current = colorGradingPass;

    const brightnessContrastPass = new ShaderPass(BrightnessContrastShader);
    brightnessContrastPass.enabled = false;
    composer.addPass(brightnessContrastPass);
    brightnessContrastPassRef.current = brightnessContrastPass;

    const ssaoPass = new SSAOPass(scene, camera, width, height);
    ssaoPass.enabled = false;
    composer.addPass(ssaoPass);
    ssaoPassRef.current = ssaoPass;

    const bokehPass = new BokehPass(scene, camera, {
      focus: DIFFUSION_PRESET.focus,
      aperture: DIFFUSION_PRESET.apertureMin,
      maxblur: DIFFUSION_PRESET.maxblurMin,
    });
    bokehPass.enabled = false;
    composer.addPass(bokehPass);
    bokehPassRef.current = bokehPass;

    const toonPass = new ShaderPass(ToonQuantizeShader);
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

    const capturePngFrame = async (frameWidth: number, frameHeight: number) => {
      const targetWidth = Math.max(2, Math.round(frameWidth));
      const targetHeight = Math.max(2, Math.round(frameHeight));

      const activeRenderPass = renderPassRef.current;
      if (!activeRenderPass) {
        throw new Error('Render pass is unavailable.');
      }

      const activeBokehPass = bokehPassRef.current;
      const activeSsaoPass = ssaoPassRef.current;
      const activeOutlinePass = outlinePassRef.current;

      const sourceCamera = activeRenderPass.camera;
      if (!(sourceCamera instanceof THREE.PerspectiveCamera)) {
        throw new Error('Active camera is not a perspective camera.');
      }

      const captureCamera = sourceCamera.clone();
      captureCamera.aspect = targetWidth / targetHeight;
      captureCamera.updateProjectionMatrix();

      const previousRenderPassCamera = activeRenderPass.camera;
      const previousBokehCamera = activeBokehPass?.camera;
      const previousSsaoCamera = activeSsaoPass?.camera;
      const previousRendererSize = renderer.getSize(new THREE.Vector2());
      const previousPixelRatio = renderer.getPixelRatio();
      const previousRenderTarget = renderer.getRenderTarget();

      try {
        activeRenderPass.camera = captureCamera;
        if (activeBokehPass) {
          activeBokehPass.camera = captureCamera;
        }
        if (activeSsaoPass) {
          activeSsaoPass.camera = captureCamera;
        }
        if (activeOutlinePass) {
          const outUniforms = (activeOutlinePass as unknown as { uniforms?: Record<string, { value: number | THREE.Vector2 }> }).uniforms;
          if (outUniforms?.resolution) {
            (outUniforms.resolution.value as THREE.Vector2).set(targetWidth, targetHeight);
          }
        }

        renderer.setPixelRatio(1);
        renderer.setSize(targetWidth, targetHeight, false);
        composer.setSize(targetWidth, targetHeight);
        activeSsaoPass?.setSize(targetWidth, targetHeight);
        activeOutlinePass?.setSize(targetWidth, targetHeight);

        renderer.setRenderTarget(null);
        composer.render();

        const blob = await new Promise<Blob>((resolve, reject) => {
          renderer.domElement.toBlob((imageBlob) => {
            if (!imageBlob) {
              reject(new Error('Failed to capture frame PNG.'));
              return;
            }
            resolve(imageBlob);
          }, 'image/png');
        });

        return blob;
      } finally {
        activeRenderPass.camera = previousRenderPassCamera;
        if (activeBokehPass && previousBokehCamera) {
          activeBokehPass.camera = previousBokehCamera;
        }
        if (activeSsaoPass && previousSsaoCamera) {
          activeSsaoPass.camera = previousSsaoCamera;
        }
        // ShaderPass doesn't need camera restoration

        renderer.setPixelRatio(previousPixelRatio);
        renderer.setSize(previousRendererSize.x, previousRendererSize.y, false);
        composer.setSize(previousRendererSize.x, previousRendererSize.y);
        ssaoPassRef.current?.setSize(previousRendererSize.x, previousRendererSize.y);
        outlinePassRef.current?.setSize(previousRendererSize.x, previousRendererSize.y);
        renderer.setRenderTarget(previousRenderTarget);
      }
    };

    captureApiRef.current = { capturePngFrame, setPaused: (paused: boolean) => { pausedRef.current = paused; } };

    composerRef.current = composer;

    const floorMaterial = new THREE.MeshStandardMaterial({
      color: 0x252a36,
      roughness: 0.75,
      metalness: 0.25,
    });

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(100, 100),
      floorMaterial,
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    workingFloorRef.current = ground;

    // Create checkerboard pattern floor with alternating tile colors
    const tileSize = 2;
    const gridCount = 25;
    const totalSize = tileSize * gridCount;
    const checkerboardGeometry = new THREE.PlaneGeometry(totalSize, totalSize);
    
    // Create checkerboard texture using canvas
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext('2d');
    
    if (context) {
      const tilePixels = canvas.width / gridCount;
      
      for (let row = 0; row < gridCount; row++) {
        for (let col = 0; col < gridCount; col++) {
          const isEven = (row + col) % 2 === 0;
          context.fillStyle = isEven ? '#2a2a3a' : '#1a1a25';
          context.fillRect(col * tilePixels, row * tilePixels, tilePixels, tilePixels);
        }
      }
      
      const texture = new THREE.CanvasTexture(canvas);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      
      const checkerboardMaterial = new THREE.MeshStandardMaterial({
        map: texture,
        color: 0xffffff,
        transparent: true,
        opacity: 0.6,
        roughness: 0.95,
        metalness: 0.05,
      });
      
      const checkerboardFloor = new THREE.Mesh(checkerboardGeometry, checkerboardMaterial);
      checkerboardFloor.rotation.x = -Math.PI / 2;
      checkerboardFloor.position.y = 0.01; // Slightly above ground to avoid z-fighting
      checkerboardFloor.receiveShadow = true;
      scene.add(checkerboardFloor);
      checkerFloorRef.current = checkerboardFloor;
      checkerFloorMaterialRef.current = checkerboardMaterial;
    }

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
      ssaoPassRef.current?.setSize(safeW, safeH);

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
      controls.update();
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
      composer.dispose();
      renderer.dispose();
      renderPassRef.current = null;
      colorGradingPassRef.current = null;
      bloomPassRef.current = null;
      bokehPassRef.current = null;
      ssaoPassRef.current = null;
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
      ambientLightRef.current = null;
      directionalLightRef.current = null;
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
    const ssaoPass = ssaoPassRef.current;
    const outlinePass = outlinePassRef.current;
    const fallbackCamera = cameraRef.current;
    const renderer = rendererRef.current;

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

    if (ssaoPass) {
      ssaoPass.camera = nextCamera;
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
    const ssaoPass = ssaoPassRef.current;
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
    const ambientLight = ambientLightRef.current;
    const directionalLight = directionalLightRef.current;
    const checkerMaterial = checkerFloorMaterialRef.current;

    if (!renderer || !colorGradingPass || !bloomPass || !bokehPass || !ssaoPass || !afterimagePass || !outlinePass || !vignettePass || !glitchPass || !ambientLight || !directionalLight) {
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
    const clampedPrincipled = c(effects.principledStrength);
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
    directionalLight.intensity = THREE.MathUtils.lerp(0.9, 1.15, clampedToneMapping);
    ambientLight.intensity = THREE.MathUtils.lerp(0.55, 0.78, clampedToneMapping);

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

    ssaoPass.enabled = effects.ambientOcclusionEnabled;
    ssaoPass.kernelRadius = Math.round(THREE.MathUtils.lerp(AO_PRESET.kernelRadiusMin, AO_PRESET.kernelRadiusMax, clampedAo));
    ssaoPass.minDistance = THREE.MathUtils.lerp(AO_PRESET.minDistanceMin, AO_PRESET.minDistanceMax, clampedAo);
    ssaoPass.maxDistance = THREE.MathUtils.lerp(AO_PRESET.maxDistanceMin, AO_PRESET.maxDistanceMax, clampedAo);

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
      const toonUniforms = (toonPass as unknown as { uniforms?: Record<string, { value: number | THREE.Vector3 }> }).uniforms;
      if (toonUniforms?.strength) {
        toonUniforms.strength.value = effects.toonShadingEnabled
          ? THREE.MathUtils.lerp(0.3, 1.0, clampedToon)
          : 0;
      }
      if (toonUniforms?.shadowThreshold) {
        toonUniforms.shadowThreshold.value = THREE.MathUtils.lerp(0.25, 0.45, clampedToon);
      }
      if (toonUniforms?.midThreshold) {
        toonUniforms.midThreshold.value = THREE.MathUtils.lerp(0.55, 0.72, clampedToon);
      }
      if (toonUniforms?.shadowDarken) {
        toonUniforms.shadowDarken.value = THREE.MathUtils.lerp(0.72, 0.52, clampedToon);
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

    const baseFloorMaterial = currentWorkingFloor?.material;
    if (baseFloorMaterial instanceof THREE.MeshStandardMaterial) {
      baseFloorMaterial.roughness = 0.95 - clampedAo * 0.7;
      baseFloorMaterial.metalness = 0.08 + clampedAo * 0.72;
      baseFloorMaterial.color.setHex(0x252a36);
      baseFloorMaterial.needsUpdate = true;
    }

    if (checkerMaterial) {
      checkerMaterial.opacity = 0.4 + clampedAo * 0.45;
      checkerMaterial.needsUpdate = true;
    }

    // --- Material Enhancement (Principled BSDF) ---
    const scene = sceneRef.current;
    if (scene) {
      const baseMap = materialBasePropsRef.current;
      scene.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) {
          return;
        }

        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        materials.forEach((material) => {
          if (!(material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshPhysicalMaterial)) {
            return;
          }

          const saved = baseMap.get(material) ?? {
            roughness: material.roughness,
            metalness: material.metalness,
            envMapIntensity: material.envMapIntensity,
            clearcoat: material instanceof THREE.MeshPhysicalMaterial ? material.clearcoat : undefined,
            clearcoatRoughness: material instanceof THREE.MeshPhysicalMaterial ? material.clearcoatRoughness : undefined,
            sheen: material instanceof THREE.MeshPhysicalMaterial ? material.sheen : undefined,
            sheenRoughness: material instanceof THREE.MeshPhysicalMaterial ? material.sheenRoughness : undefined,
          };

          if (!baseMap.has(material)) {
            baseMap.set(material, saved);
          }

          if (effects.principledEnabled) {
            const t = clampedPrincipled;
            material.roughness = THREE.MathUtils.lerp(saved.roughness ?? 0.7, 0.25, t);
            material.metalness = THREE.MathUtils.lerp(saved.metalness ?? 0.1, 0.45, t);
            material.envMapIntensity = THREE.MathUtils.lerp(saved.envMapIntensity ?? 1, 1.9, t);
            if (material instanceof THREE.MeshPhysicalMaterial) {
              material.clearcoat = THREE.MathUtils.lerp(saved.clearcoat ?? 0, 0.6, t);
              material.clearcoatRoughness = THREE.MathUtils.lerp(saved.clearcoatRoughness ?? 0, 0.22, t);
              material.sheen = THREE.MathUtils.lerp(saved.sheen ?? 0, 0.35, t);
              material.sheenRoughness = THREE.MathUtils.lerp(saved.sheenRoughness ?? 1, 0.55, t);
            }
          } else {
            material.roughness = saved.roughness ?? material.roughness;
            material.metalness = saved.metalness ?? material.metalness;
            material.envMapIntensity = saved.envMapIntensity ?? material.envMapIntensity;
            if (material instanceof THREE.MeshPhysicalMaterial) {
              material.clearcoat = saved.clearcoat ?? material.clearcoat;
              material.clearcoatRoughness = saved.clearcoatRoughness ?? material.clearcoatRoughness;
              material.sheen = saved.sheen ?? material.sheen;
              material.sheenRoughness = saved.sheenRoughness ?? material.sheenRoughness;
            }
          }

          material.needsUpdate = true;
        });
      });
    }
  }, [effects, defaultStageVisible]);

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
