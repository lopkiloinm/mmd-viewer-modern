import { useEffect, useRef, useState, useCallback, type ChangeEvent } from 'react';
import * as THREE from 'three';
import {
  ThreeScene,
  type CameraTranslationOffset,
  type ThreeSceneCaptureApi,
  type ViewportEffects,
} from './components/ThreeScene';
import { TimelinePanel, type TimelineTrack } from './components/TimelinePanel';
import { Button } from './components/ui/button';
import { X, FolderOpen, FileArchive, UserPlus, Box, Loader2, AlertCircle, Film, Camera, Package, Archive, Layers, Image as ImageIcon, Activity, Settings2, PlaySquare, Move } from 'lucide-react';
import type { Character } from './hooks/useModelLoader';
import { discoverModelsFromFolder, extractAndDiscoverFromZip } from './utils/folderLoader';
import { exportPngSequenceToZip } from './utils/videoExport';
import { clearMmdStageColliders, installMmdStageEnvironmentBridge } from './utils/mmdStageColliders';
import { OrbitControls } from '@three-jsm/controls/OrbitControls.js';

interface MMDCamera {
  id: number;
  name: string;
  vmdFile: File | null;
  vmdClip: THREE.AnimationClip | null;
  durationFrames: number;
  camera: THREE.PerspectiveCamera;
  loaded: boolean;
  loading: boolean;
  error?: string;
}

type ExportAspectPreset = '9:16' | '16:9' | '1:1' | '4:5';

interface ExportSettings {
  aspectPreset: ExportAspectPreset;
  width: number;
  height: number;
  fps: number;
  pixelFormat: 'yuv420p';
  videoCodec: 'libx264';
}

const EXPORT_ASPECT_PRESETS: Record<ExportAspectPreset, { width: number; height: number }> = {
  '9:16': { width: 1080, height: 1920 },
  '16:9': { width: 1920, height: 1080 },
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
};

const defaultExportSettings: ExportSettings = {
  aspectPreset: '9:16',
  width: 1080,
  height: 1920,
  fps: 30,
  pixelFormat: 'yuv420p',
  videoCodec: 'libx264',
};

const defaultViewportEffects: ViewportEffects = {
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

const CHARACTER_MATERIAL_MODE_OPTIONS = [
  { id: 'physical', label: 'Physical (MeshPhysical)' },
  { id: 'standard', label: 'Standard (MeshStandard)' },
  { id: 'phong', label: 'Classic (MeshPhong)' },
  { id: 'lambert', label: 'Classic (MeshLambert)' },
  { id: 'toon', label: 'Toon (MeshToon)' },
  { id: 'matcap', label: 'Matcap (MeshMatcap)' },
] as const;

type EffectsPresetKey = 'none' | 'default' | 'cleanStudio' | 'cinematic' | 'animeCel' | 'dreamy' | 'musicVideo' | 'photoReal' | 'retro';

const EFFECTS_PRESETS: Record<EffectsPresetKey, { name: string; description: string; effects: Partial<ViewportEffects> }> = {
  none: {
    name: 'None',
    description: 'All effects disabled',
    effects: {
      toneMappingEnabled: false, toneMappingStrength: 0.28,
      colorGradingEnabled: false, colorGradingStrength: 0.35, colorGradingPreset: 'neutral',
      brightnessContrastEnabled: false, brightnessContrastStrength: 0.5,
      meshPhysicalEnabled: false, meshPhysicalStrength: 0.45,
      meshRimGlowEnabled: false, meshRimGlowStrength: 0.4,
      rimLightingEnabled: false, rimLightingStrength: 0.35, rimLightingCameraAligned: true,
      iblStudioPortraitEnabled: false, iblStudioPortraitStrength: 0.45,
      bloomEnabled: false, bloomStrength: 0.22, glowPreset: 'studio',
      depthOfFieldEnabled: false, depthOfFieldStrength: 0.25,
      ambientOcclusionEnabled: false, ambientOcclusionStrength: 0.45,
      vignetteEnabled: false, vignetteStrength: 0.35,
      toonShadingEnabled: false, toonShadingStrength: 0.5,
      outlineEnabled: false, outlineStrength: 0.4,
      invertedHullOutlineEnabled: false, invertedHullOutlineStrength: 0.35,
      posterizeEnabled: false, posterizeStrength: 0.4,
      pixelateEnabled: false, pixelateStrength: 0.3,
      afterimageEnabled: false, afterimageStrength: 0.18,
      glitchEnabled: false, glitchStrength: 0.18,
      chromaticAberrationEnabled: false, chromaticAberrationStrength: 0.3,
      filmGrainEnabled: false, filmGrainStrength: 0.25,
      sharpenEnabled: false, sharpenStrength: 0.3,
      sepiaEnabled: false, sepiaStrength: 0.4,
    },
  },
  default: {
    name: 'Default',
    description: 'Balanced starting point',
    effects: { ...defaultViewportEffects },
  },
  cleanStudio: {
    name: 'Clean Studio',
    description: 'Neutral tones, subtle enhancement',
    effects: {
      toneMappingEnabled: true, toneMappingStrength: 0.3,
      colorGradingEnabled: true, colorGradingStrength: 0.2, colorGradingPreset: 'neutral',
      brightnessContrastEnabled: true, brightnessContrastStrength: 0.4,
      bloomEnabled: true, bloomStrength: 0.15, glowPreset: 'soft',
      ambientOcclusionEnabled: true, ambientOcclusionStrength: 0.3,
      meshPhysicalEnabled: true, meshPhysicalStrength: 0.35,
      meshRimGlowEnabled: true, meshRimGlowStrength: 0.32,
      rimLightingEnabled: true, rimLightingStrength: 0.42, rimLightingCameraAligned: true,
      iblStudioPortraitEnabled: true, iblStudioPortraitStrength: 0.4,
      sharpenEnabled: true, sharpenStrength: 0.2,
    },
  },
  cinematic: {
    name: 'Cinematic',
    description: 'Film-like depth and warmth',
    effects: {
      toneMappingEnabled: true, toneMappingStrength: 0.4,
      colorGradingEnabled: true, colorGradingStrength: 0.5, colorGradingPreset: 'cinematic',
      brightnessContrastEnabled: true, brightnessContrastStrength: 0.55,
      bloomEnabled: true, bloomStrength: 0.3, glowPreset: 'studio',
      depthOfFieldEnabled: true, depthOfFieldStrength: 0.3,
      ambientOcclusionEnabled: true, ambientOcclusionStrength: 0.5,
      vignetteEnabled: true, vignetteStrength: 0.4,
      meshPhysicalEnabled: true, meshPhysicalStrength: 0.45,
      meshRimGlowEnabled: true, meshRimGlowStrength: 0.38,
      rimLightingEnabled: true, rimLightingStrength: 0.52, rimLightingCameraAligned: true,
      iblStudioPortraitEnabled: true, iblStudioPortraitStrength: 0.5,
      filmGrainEnabled: true, filmGrainStrength: 0.1,
    },
  },
  animeCel: {
    name: 'Anime / Cel',
    description: 'Genshin-style toon shading with dark outlines',
    effects: {
      toneMappingEnabled: true, toneMappingStrength: 0.3,
      colorGradingEnabled: true, colorGradingStrength: 0.45, colorGradingPreset: 'anime',
      bloomEnabled: true, bloomStrength: 0.18, glowPreset: 'soft',
      toonShadingEnabled: true, toonShadingStrength: 0.55,
      outlineEnabled: true, outlineStrength: 0.4,
      invertedHullOutlineEnabled: true, invertedHullOutlineStrength: 0.38,
      ambientOcclusionEnabled: true, ambientOcclusionStrength: 0.3,
      sharpenEnabled: true, sharpenStrength: 0.2,
    },
  },
  dreamy: {
    name: 'Dreamy',
    description: 'Soft ethereal glow',
    effects: {
      colorGradingEnabled: true, colorGradingStrength: 0.4, colorGradingPreset: 'warm',
      bloomEnabled: true, bloomStrength: 0.6, glowPreset: 'dream',
      depthOfFieldEnabled: true, depthOfFieldStrength: 0.4,
      afterimageEnabled: true, afterimageStrength: 0.3,
      vignetteEnabled: true, vignetteStrength: 0.35,
    },
  },
  musicVideo: {
    name: 'Music Video',
    description: 'High energy with chromatic punch',
    effects: {
      toneMappingEnabled: true, toneMappingStrength: 0.35,
      colorGradingEnabled: true, colorGradingStrength: 0.6, colorGradingPreset: 'cinematic',
      brightnessContrastEnabled: true, brightnessContrastStrength: 0.6,
      bloomEnabled: true, bloomStrength: 0.5, glowPreset: 'neon',
      chromaticAberrationEnabled: true, chromaticAberrationStrength: 0.35,
      vignetteEnabled: true, vignetteStrength: 0.45,
      afterimageEnabled: true, afterimageStrength: 0.25,
    },
  },
  photoReal: {
    name: 'Photo Realistic',
    description: 'Enhanced PBR with subtle grading',
    effects: {
      toneMappingEnabled: true, toneMappingStrength: 0.35,
      colorGradingEnabled: true, colorGradingStrength: 0.25, colorGradingPreset: 'neutral',
      ambientOcclusionEnabled: true, ambientOcclusionStrength: 0.55,
      meshPhysicalEnabled: true, meshPhysicalStrength: 0.65,
      meshRimGlowEnabled: true, meshRimGlowStrength: 0.42,
      rimLightingEnabled: true, rimLightingStrength: 0.55, rimLightingCameraAligned: true,
      iblStudioPortraitEnabled: true, iblStudioPortraitStrength: 0.55,
      depthOfFieldEnabled: true, depthOfFieldStrength: 0.2,
      filmGrainEnabled: true, filmGrainStrength: 0.12,
      sharpenEnabled: true, sharpenStrength: 0.25,
    },
  },
  retro: {
    name: 'Retro',
    description: 'Vintage pixel art aesthetic',
    effects: {
      colorGradingEnabled: true, colorGradingStrength: 0.3, colorGradingPreset: 'warm',
      pixelateEnabled: true, pixelateStrength: 0.35,
      filmGrainEnabled: true, filmGrainStrength: 0.4,
      sepiaEnabled: true, sepiaStrength: 0.45,
      vignetteEnabled: true, vignetteStrength: 0.5,
      posterizeEnabled: true, posterizeStrength: 0.4,
    },
  },
};

function App() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [fps, setFps] = useState(30);
  const [timelineEndFrame, setTimelineEndFrame] = useState(300);
  const [activeTab, setActiveTab] = useState<'characters' | 'cameras' | 'scene' | 'effects' | 'export'>('characters');
  const [viewportEffects, setViewportEffects] = useState<ViewportEffects>(defaultViewportEffects);
  const [exportSettings, setExportSettings] = useState<ExportSettings>(defaultExportSettings);
  const [defaultStageVisible, setDefaultStageVisible] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selectedCharId, setSelectedCharId] = useState<number | null>(null);
  
  const [cameras, setCameras] = useState<MMDCamera[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<number | null>(null);
  const [activeCameraId, setActiveCameraId] = useState<number | null>(null); // the one currently driving the view
  const [cameraTranslation, setCameraTranslation] = useState<CameraTranslationOffset>({ x: 0, y: 0, z: 0 });

  const [loadingByCharId, setLoadingByCharId] = useState<Record<number, boolean>>({});
  const [errorByCharId, setErrorByCharId] = useState<Record<number, string | undefined>>({});

  const fileInputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({});
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const sceneCaptureApiRef = useRef<ThreeSceneCaptureApi | null>(null);
  
  const charactersRef = useRef<Character[]>([]);
  const camerasRef = useRef<MMDCamera[]>([]);
  const activeCameraIdRef = useRef<number | null>(null);
  const mmdCameraHelperRef = useRef<any>(null); // MMDAnimationHelper for camera
  const boundMmdCameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  
  const nextCharIdRef = useRef(0);
  const nextCameraIdRef = useRef(0);
  const initializedRef = useRef(false);
  const textureUrlByFileRef = useRef<Map<File, string>>(new Map());
  const textureUrlByKeyRef = useRef<Map<string, string>>(new Map());
  const currentFrameRef = useRef(0);
  const fpsRef = useRef(30);
  const isPlayingRef = useRef(false);
  const playbackTimeRef = useRef(0);
  const lastRafTimeRef = useRef(performance.now());
  const rafRef = useRef<number | null>(null);
  const timelineEndFrameRef = useRef(timelineEndFrame);
  const ammoInitPromiseRef = useRef<Promise<boolean> | null>(null);
  const defaultStageVisibleRef = useRef(true);
  const isTimelineScrubbingRef = useRef(false);
  const exportInFlightRef = useRef(false);

  useEffect(() => {
    defaultStageVisibleRef.current = defaultStageVisible;
  }, [defaultStageVisible]);

  const seekMixerTo = useCallback((mixer: THREE.AnimationMixer, timeInSeconds: number) => {
    const actions = (mixer as unknown as { _actions: THREE.AnimationAction[] })._actions;
    for (const action of actions) {
      if (action.paused) action.paused = false;
      action.enabled = true;
    }
    mixer.setTime(timeInSeconds);
  }, []);

  const syncAllToFrame = useCallback((frame: number, options?: { resetPhysics?: boolean }) => {
    const timeInSeconds = frame / Math.max(fpsRef.current, 1);
    const shouldResetPhysics = options?.resetPhysics ?? true;
    
    charactersRef.current.forEach((char) => {
      if (char.mmdHelper && char.mmdMesh) {
        const helperState = char.mmdHelper.objects.get(char.mmdMesh);
        if (helperState?.mixer) {
          seekMixerTo(helperState.mixer, timeInSeconds);
        }
        if (shouldResetPhysics && helperState?.physics) {
          helperState.physics.reset();
        }
        char.mmdHelper.update(0);
      } else if (char.mixer) {
        seekMixerTo(char.mixer, timeInSeconds);
      }
    });

    if (mmdCameraHelperRef.current && boundMmdCameraRef.current) {
      const helperState = mmdCameraHelperRef.current.objects.get(boundMmdCameraRef.current);
      if (helperState?.mixer) {
        seekMixerTo(helperState.mixer, timeInSeconds);
      }
      mmdCameraHelperRef.current.update(0);
    }
  }, [seekMixerTo]);

  const bindActiveCameraMotion = useCallback(async (cameraId: number | null) => {
    if (!mmdCameraHelperRef.current) {
      const { MMDAnimationHelper } = await import('@three-mmd/animation/MMDAnimationHelper.js');
      mmdCameraHelperRef.current = new MMDAnimationHelper();
    }

    if (boundMmdCameraRef.current) {
      try {
        mmdCameraHelperRef.current.remove(boundMmdCameraRef.current);
      } catch {}
      boundMmdCameraRef.current = null;
    }

    if (cameraId === null) {
      return;
    }

    const cam = camerasRef.current.find((entry) => entry.id === cameraId);
    if (!cam?.vmdClip || !cam.camera) {
      return;
    }

    mmdCameraHelperRef.current.add(cam.camera, { animation: cam.vmdClip, physics: false });
    const helperState = mmdCameraHelperRef.current.objects.get(cam.camera);
    helperState?.mixer?.setTime(currentFrameRef.current / Math.max(fpsRef.current, 1));
    mmdCameraHelperRef.current.update(0);
    boundMmdCameraRef.current = cam.camera;
  }, []);

  // Main animation and physics loop
  useEffect(() => {
    const loop = (time: number) => {
      rafRef.current = requestAnimationFrame(loop);
      
      const deltaMs = time - lastRafTimeRef.current;
      lastRafTimeRef.current = time;
      // Cap delta to 0.1s to avoid huge jumps
      const deltaSeconds = Math.min(deltaMs / 1000, 0.1);

      if (exportInFlightRef.current) {
        return;
      }
      
      if (isPlayingRef.current) {
        playbackTimeRef.current += deltaSeconds;
        const nextFrame = Math.floor(playbackTimeRef.current * fpsRef.current);
        
        if (nextFrame > timelineEndFrameRef.current) {
          isPlayingRef.current = false;
          setIsPlaying(false);
          currentFrameRef.current = 0;
          playbackTimeRef.current = 0;
          setCurrentFrame(0);
          syncAllToFrame(0);
        } else {
          if (nextFrame !== currentFrameRef.current) {
            currentFrameRef.current = nextFrame;
            setCurrentFrame(nextFrame);
          }
          
          charactersRef.current.forEach((char) => {
            if (char.mmdHelper) {
              char.mmdHelper.update(deltaSeconds);
            } else if (char.mixer) {
              char.mixer.update(deltaSeconds);
            }
          });

          // Camera has no physics — always seek absolutely so it clamps
          // at its last keyframe instead of wrapping or drifting.
          if (mmdCameraHelperRef.current && boundMmdCameraRef.current) {
            const camTime = playbackTimeRef.current;
            const helperState = mmdCameraHelperRef.current.objects.get(boundMmdCameraRef.current);
            if (helperState?.mixer) {
              seekMixerTo(helperState.mixer, camTime);
            }
            mmdCameraHelperRef.current.update(0);
          }
        }
      } else {
        // Paused: keep animation and physics locked to the exact current timeline frame.
        syncAllToFrame(currentFrameRef.current, { resetPhysics: false });
      }
    };
    
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [syncAllToFrame]);

  const transparentTextureDataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
  const envTextureDataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  const normalizePath = (value: string) => value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '').toLowerCase();

  const applyCharTx = (group: THREE.Group, tx: Character['tx']) => {
    group.position.set(tx.x, tx.y, tx.z);
    group.rotation.set(
      THREE.MathUtils.degToRad(tx.rx),
      THREE.MathUtils.degToRad(tx.ry),
      THREE.MathUtils.degToRad(tx.rz),
    );
    group.scale.setScalar(tx.s);
  };

  const getMmdAnimationTarget = (object: THREE.Object3D) => {
    if (object instanceof THREE.SkinnedMesh) {
      return object;
    }

    let target: THREE.SkinnedMesh | null = null;
    object.traverse((child) => {
      if (!target && child instanceof THREE.SkinnedMesh) {
        target = child;
      }
    });

    return target;
  };

  const ensureAmmo = async () => {
    const scope = globalThis as typeof globalThis & { Ammo?: unknown };

    if (scope.Ammo) {
      return true;
    }

    if (!ammoInitPromiseRef.current) {
      ammoInitPromiseRef.current = import('@three-jsm/libs/ammo.wasm.js')
        .then(async (mod) => {
          const wasmRootUrl = `${import.meta.env.BASE_URL.replace(/\/?$/, '/')}ammo.wasm.wasm`;

          // The vendored ammo.wasm.js now has `export default Ammo` at the end.
          // `Ammo` is a factory function: call it to start wasm init, returns `Ammo.ready` Promise.
          const factory = (mod as { default?: unknown }).default ?? mod;

          if (typeof factory !== 'function') {
            const keys = mod && typeof mod === 'object' ? Object.keys(mod as object).join(', ') : String(typeof mod);
            throw new Error(`Ammo.js: expected factory function, got ${typeof factory} (module keys: ${keys || 'none'})`);
          }

          const ammo = await (factory as (this: unknown, opts?: Record<string, unknown>) => Promise<unknown>).call(
            scope,
            { locateFile: (path: string) => (path.endsWith('ammo.wasm.wasm') ? wasmRootUrl : path) },
          );

          if (!ammo) {
            throw new Error('Ammo.js initialization returned undefined');
          }
          scope.Ammo = ammo;
          return true;
        })
        .catch((error) => {
          console.warn('Ammo.js unavailable, continuing without MMD physics.', error);
          // Clear the promise so it can be retried
          ammoInitPromiseRef.current = null;
          return false;
        });
    }

    return ammoInitPromiseRef.current;
  };

  const disposeCharacterAnimation = (char: Character) => {
    if (char.action) {
      char.action.stop();
    }

    if (char.mixer) {
      char.mixer.stopAllAction();

      if (char.mmdMesh || char.mesh) {
        const animationTarget = char.mmdMesh ?? (char.mesh ? getMmdAnimationTarget(char.mesh) : null);
        char.mixer.uncacheRoot(animationTarget ?? char.mesh!);
      }
    }

    if (char.mmdHelper && char.mmdMesh) {
      const helperState = char.mmdHelper.objects.get(char.mmdMesh);
      if (helperState?.physics) {
        clearMmdStageColliders(helperState.physics);
      }
      try {
        char.mmdHelper.remove(char.mmdMesh);
      } catch {}
    }

    if (char.mmdMesh instanceof THREE.SkinnedMesh) {
      char.mmdMesh.pose();
      char.mmdMesh.updateMatrixWorld(true);
    }

    if (char.mesh) {
      char.mesh.updateMatrixWorld(true);
    }

    if (char.mmdMesh) {
      char.mmdMesh.updateMatrixWorld(true);
    }
  };

  const addChar = (isStage: boolean = false) => {
    const id = nextCharIdRef.current++;
    const group = new THREE.Group();
    const ch: Character = {
      id,
      type: isStage ? 'stage' : 'character',
      modelFile: null,
      texFiles: [],
      vmdFiles: [],
      vrmaFile: null,
      fbxMotionFile: null,
      bvhMotionFile: null,
      mesh: null,
      mmdMesh: null,
      mmdHelper: null,
      vmdClip: null,
      vrmaClip: null,
      fbxClip: null,
      bvhClip: null,
      mixer: null,
      action: null,
      durationFrames: 0,
      physicsEnabled: false,
      group,
      tx: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, s: 1 },
      outlines: [],
      loaded: false,
      parent: null,
    };

    applyCharTx(group, ch.tx);

    if (sceneRef.current) {
      sceneRef.current.add(group);
    }

    setCharacters((prev) => [...prev, ch]);
    setSelectedCharId(id);
    return ch;
  };

  useEffect(() => {
    charactersRef.current = characters;
  }, [characters]);

  useEffect(() => {
    camerasRef.current = cameras;
  }, [cameras]);

  useEffect(() => {
    activeCameraIdRef.current = activeCameraId;
    if (controlsRef.current) {
      controlsRef.current.enabled = activeCameraId === null;
    }
    void bindActiveCameraMotion(activeCameraId);
  }, [activeCameraId]);

  const addCamera = () => {
    const id = nextCameraIdRef.current++;
    const fallbackCamera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000);
    fallbackCamera.position.set(0, 10, 22);
    const sourceCamera = cameraRef.current;
    const runtimeCamera = sourceCamera
      ? (sourceCamera.clone() as THREE.PerspectiveCamera)
      : fallbackCamera;

    if (sourceCamera) {
      runtimeCamera.aspect = sourceCamera.aspect;
      runtimeCamera.fov = sourceCamera.fov;
      runtimeCamera.near = sourceCamera.near;
      runtimeCamera.far = sourceCamera.far;
      runtimeCamera.position.copy(sourceCamera.position);
      runtimeCamera.quaternion.copy(sourceCamera.quaternion);
      runtimeCamera.updateProjectionMatrix();
    }

    const cam: MMDCamera = {
      id,
      name: `Camera ${id + 1}`,
      vmdFile: null,
      vmdClip: null,
      durationFrames: 0,
      camera: runtimeCamera,
      loaded: false,
      loading: false,
      error: undefined,
    };
    setCameras((prev) => [...prev, cam]);
    setSelectedCameraId(id);
    if (activeCameraId === null) {
      setActiveCameraId(id);
    }
    return cam;
  };

  const removeCamera = (id: number) => {
    setCameras((prev) => {
      const next = prev.filter((c) => c.id !== id);
      
      // If we removed the active camera, pick another one or null
      if (activeCameraId === id) {
        setActiveCameraId(next.length > 0 ? next[0].id : null);
      }
      return next;
    });

    if (selectedCameraId === id) {
      setSelectedCameraId(null);
    }

    if (activeCameraId === id && mmdCameraHelperRef.current && boundMmdCameraRef.current) {
      try {
        mmdCameraHelperRef.current.remove(boundMmdCameraRef.current);
      } catch {}
      boundMmdCameraRef.current = null;
    }
  };

  const handleCameraVmdUpload = async (event: ChangeEvent<HTMLInputElement>, id: number) => {
    const files = event.target.files;
    const vmdFile = files ? Array.from(files).find((file) => /\.vmd$/i.test(file.name)) : null;
    event.target.value = '';

    if (!vmdFile) return;

    setCameras((prev) => prev.map((cam) => (
      cam.id === id ? { ...cam, vmdFile, loaded: false, loading: true, error: undefined, vmdClip: null, durationFrames: 0 } : cam
    )));

    const targetCamera = camerasRef.current.find((cam) => cam.id === id)?.camera ?? null;

    if (!targetCamera) {
      setCameras((prev) => prev.map((cam) => (
        cam.id === id ? { ...cam, loaded: false, loading: false, error: 'Camera instance is not initialized yet.' } : cam
      )));
      return;
    }

    const { MMDLoader } = await import('@three-mmd/loaders/MMDLoader.js');
    const { MMDAnimationHelper } = await import('@three-mmd/animation/MMDAnimationHelper.js');
    const loader = new MMDLoader(new THREE.LoadingManager());
    const vmdUrl = URL.createObjectURL(vmdFile);

    try {
        const clip = await new Promise<THREE.AnimationClip>((resolve, reject) => {
          loader.loadAnimation(vmdUrl, targetCamera, (animation: any) => resolve(animation as THREE.AnimationClip), undefined, reject);
        });

      const fpsValue = Math.max(fpsRef.current, 1);
      const durationFromClip = Number.isFinite(clip.duration) && clip.duration > 0
        ? Math.floor(clip.duration * fpsValue)
        : 0;
      const maxTrackTime = clip.tracks.reduce((max, track) => {
        if (!track.times || track.times.length === 0) {
          return max;
        }
        return Math.max(max, track.times[track.times.length - 1]);
      }, 0);
      const durationFromTracks = Number.isFinite(maxTrackTime) && maxTrackTime > 0
        ? Math.floor(maxTrackTime * fpsValue)
        : 0;
      const durationFrames = Math.max(durationFromClip, durationFromTracks, 1);

      setTimelineEndFrame(prev => Math.max(prev, durationFrames));

      setCameras((prev) => prev.map((cam) => (
        cam.id === id ? { ...cam, vmdClip: clip, durationFrames, loaded: true, loading: false, error: undefined } : cam
      )));

      // If this is the active camera, load it into the helper
      if (activeCameraIdRef.current === id) {
        if (!mmdCameraHelperRef.current) {
          mmdCameraHelperRef.current = new MMDAnimationHelper();
        }
        if (boundMmdCameraRef.current) {
          try {
            mmdCameraHelperRef.current.remove(boundMmdCameraRef.current);
          } catch {}
          boundMmdCameraRef.current = null;
        }
        mmdCameraHelperRef.current.add(targetCamera, { animation: clip, physics: false });
        const helperState = mmdCameraHelperRef.current.objects.get(targetCamera);
        helperState?.mixer?.setTime(currentFrameRef.current / Math.max(fpsRef.current, 1));
        mmdCameraHelperRef.current.update(0);
        boundMmdCameraRef.current = targetCamera;
      }

    } catch (error) {
      console.error('Failed to load camera VMD:', error);
      const message = error instanceof Error ? error.message : 'Failed to load camera VMD';
      setCameras((prev) => prev.map((cam) => (
        cam.id === id ? { ...cam, loaded: false, loading: false, error: message, vmdClip: null, durationFrames: 0 } : cam
      )));
    } finally {
      URL.revokeObjectURL(vmdUrl);
    }
  };

  const switchActiveCamera = async (id: number | null) => {
    setActiveCameraId(id);
    await bindActiveCameraMotion(id);
  };

  const activeRuntimeCamera = activeCameraId === null
    ? null
    : (cameras.find((cam) => cam.id === activeCameraId)?.camera ?? null);

  useEffect(() => {
    if (initializedRef.current) {
      return;
    }

    initializedRef.current = true;
    const first = addChar();
    setSelectedCharId(first.id);

    return () => {
      charactersRef.current.forEach(disposeCharacterAnimation);
      textureUrlByFileRef.current.forEach((url) => URL.revokeObjectURL(url.split('#')[0]));
      textureUrlByFileRef.current.clear();
      textureUrlByKeyRef.current.clear();
    };
  }, []);

  useEffect(() => {
    currentFrameRef.current = currentFrame;
  }, [currentFrame]);

  useEffect(() => {
    fpsRef.current = fps;
  }, [fps]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    setCharacters((prev) => {
      let changed = false;
      const next = prev.map((char) => {
        const clip = char.vmdClip ?? char.vrmaClip ?? char.fbxClip ?? char.bvhClip;
        const nextDurationFrames = clip ? Math.max(1, Math.floor(clip.duration * fps)) : 0;

        if (nextDurationFrames === char.durationFrames) {
          return char;
        }

        changed = true;
        return {
          ...char,
          durationFrames: nextDurationFrames,
        };
      });

      return changed ? next : prev;
    });
  }, [fps]);

  useEffect(() => {
    const maxDuration = characters.reduce((max, char) => Math.max(max, char.durationFrames), 0);
    if (maxDuration > 0) {
      setTimelineEndFrame(maxDuration);
    }
  }, [characters]);

  useEffect(() => {
    timelineEndFrameRef.current = timelineEndFrame;
  }, [timelineEndFrame]);

  // Removed problematic useEffect that was resetting physics on pause or character add.

  useEffect(() => {
    if (isPlaying && !characters.some((char) => char.action && char.durationFrames > 0) && !cameras.some(c => c.vmdClip && c.durationFrames > 0)) {
      isPlayingRef.current = false;
      setIsPlaying(false);
    }
  }, [characters, cameras, isPlaying]);

  useEffect(() => {
    if (!isPlaying) {
      isPlayingRef.current = false;
      return;
    }
    
    isPlayingRef.current = true;
    playbackTimeRef.current = currentFrameRef.current / Math.max(fpsRef.current, 1);
    syncAllToFrame(currentFrameRef.current);
    void bindActiveCameraMotion(activeCameraIdRef.current);
  }, [isPlaying]);

  // The old timeout-based playback loop has been removed.

  const getTextureUrlForFile = (file: File) => {
    const existingUrl = textureUrlByFileRef.current.get(file);

    if (existingUrl) {
      return existingUrl;
    }

    const url = `${URL.createObjectURL(file)}#${file.name}`;
    textureUrlByFileRef.current.set(file, url);
    return url;
  };

  const getRelativeTexturePath = (file: File) => {
    if (file.webkitRelativePath) {
      const parts = normalizePath(file.webkitRelativePath).split('/').filter(Boolean);

      if (parts.length > 1) {
        return parts.slice(1).join('/');
      }
    }

    return normalizePath(file.name);
  };

  const registerTextureFile = (file: File) => {
    const normalizedRelativePath = getRelativeTexturePath(file);
    const fullRelativePath = normalizePath(file.webkitRelativePath || file.name);
    const pathParts = normalizedRelativePath.split('/').filter(Boolean);
    const url = getTextureUrlForFile(file);
    const keys = new Set<string>();

    keys.add(normalizedRelativePath);
    keys.add(fullRelativePath);
    keys.add(normalizePath(file.name));

    if (!normalizedRelativePath.startsWith('./')) {
      keys.add(`./${normalizedRelativePath}`);
    }

    for (let index = 0; index < pathParts.length - 1; index += 1) {
      keys.add(pathParts.slice(index).join('/'));
    }

    try {
      keys.add(normalizePath(encodeURIComponent(file.name)));
      keys.add(normalizePath(decodeURIComponent(pathParts[pathParts.length - 1] ?? file.name)));
    } catch {}

    keys.forEach((key) => {
      textureUrlByKeyRef.current.set(key, url);
    });
  };

  const resolveMappedTextureUrl = (path: string) => {
    const normalized = normalizePath(path);

    if (textureUrlByKeyRef.current.has(normalized)) {
      return textureUrlByKeyRef.current.get(normalized) ?? null;
    }

    const withoutRelative = normalized.replace(/^\.\//, '');
    if (textureUrlByKeyRef.current.has(withoutRelative)) {
      return textureUrlByKeyRef.current.get(withoutRelative) ?? null;
    }

    const pathParts = normalized.split('/').filter(Boolean);
    const name = pathParts[pathParts.length - 1];
    if (name && textureUrlByKeyRef.current.has(name)) {
      return textureUrlByKeyRef.current.get(name) ?? null;
    }

    if (normalized.includes('../')) {
      const resolved = normalized.split('/').reduce<string[]>((accumulator, segment) => {
        if (segment === '..') {
          accumulator.pop();
        } else if (segment !== '.') {
          accumulator.push(segment);
        }

        return accumulator;
      }, []).join('/');

      if (textureUrlByKeyRef.current.has(resolved)) {
        return textureUrlByKeyRef.current.get(resolved) ?? null;
      }

      const resolvedName = resolved.split('/').pop();
      if (resolvedName && textureUrlByKeyRef.current.has(resolvedName)) {
        return textureUrlByKeyRef.current.get(resolvedName) ?? null;
      }
    }

    try {
      const decoded = normalizePath(decodeURIComponent(path));

      if (textureUrlByKeyRef.current.has(decoded)) {
        return textureUrlByKeyRef.current.get(decoded) ?? null;
      }

      const decodedWithoutRelative = decoded.replace(/^\.\//, '');
      if (textureUrlByKeyRef.current.has(decodedWithoutRelative)) {
        return textureUrlByKeyRef.current.get(decodedWithoutRelative) ?? null;
      }

      const decodedName = decoded.split('/').pop();
      if (decodedName && textureUrlByKeyRef.current.has(decodedName)) {
        return textureUrlByKeyRef.current.get(decodedName) ?? null;
      }
    } catch {}

    try {
      if (name) {
        const encoded = normalizePath(encodeURIComponent(name));
        if (textureUrlByKeyRef.current.has(encoded)) {
          return textureUrlByKeyRef.current.get(encoded) ?? null;
        }
      }
    } catch {}

    if (path.includes('blob:')) {
      const afterHash = path.split('#').pop();
      if (afterHash) {
        const afterHashNormalized = normalizePath(afterHash);
        if (textureUrlByKeyRef.current.has(afterHashNormalized)) {
          return textureUrlByKeyRef.current.get(afterHashNormalized) ?? null;
        }
      }

      const blobMatch = path.match(/blob:[^/]+\/(.+)/);
      if (blobMatch) {
        const tail = normalizePath(blobMatch[1].split('#')[0]);
        if (textureUrlByKeyRef.current.has(tail)) {
          return textureUrlByKeyRef.current.get(tail) ?? null;
        }

        const tailName = tail.split('/').pop();
        if (tailName && textureUrlByKeyRef.current.has(tailName)) {
          return textureUrlByKeyRef.current.get(tailName) ?? null;
        }
      }
    }

    if (name) {
      for (const [key, value] of textureUrlByKeyRef.current.entries()) {
        if (key.endsWith(`/${name}`) || key === name) {
          return value;
        }
      }
    }

    return null;
  };

  const resolveTextureUrl = (url: string) => {
    if (url.startsWith('data:')) {
      const base = url.split('#')[0];

      if (/^data:[a-z]+\/[a-z0-9.+\-]+(;|,)/i.test(base)) {
        return base;
      }

      const fakePath = base.slice(5);
      return resolveMappedTextureUrl(fakePath) ?? transparentTextureDataUri;
    }

    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }

    if (url.startsWith('blob:')) {
      if (url.includes('#')) {
        return url;
      }

      return resolveMappedTextureUrl(url) ?? url;
    }

    const mapped = resolveMappedTextureUrl(url);
    if (mapped) {
      return mapped;
    }

    const extension = url.split('.').pop()?.split('#')[0]?.split('?')[0]?.toLowerCase();
    if (extension === 'sph' || extension === 'spa') {
      return envTextureDataUri;
    }

    return transparentTextureDataUri;
  };

  const loadVmdForCharacter = async (charId: number, nextVmdFiles?: File[], meshOverride?: THREE.Object3D | null) => {
    const currentChar = charactersRef.current.find((char) => char.id === charId);
    const vmdFiles = nextVmdFiles ?? currentChar?.vmdFiles ?? [];
    const mesh = meshOverride ?? currentChar?.mesh ?? null;
    const animationTarget = mesh ? getMmdAnimationTarget(mesh) : null;

    if (!currentChar || !mesh || !animationTarget || vmdFiles.length === 0) {
      return;
    }

    setLoadingByCharId((prev) => ({ ...prev, [charId]: true }));
    setErrorByCharId((prev) => ({ ...prev, [charId]: undefined }));
    disposeCharacterAnimation(currentChar);

    const [{ MMDLoader }, { MMDAnimationHelper: ThreeMMDAnimationHelper }, physicsAvailable] = await Promise.all([
      import('@three-mmd/loaders/MMDLoader.js'),
      import('@three-mmd/animation/MMDAnimationHelper.js'),
      ensureAmmo(),
    ]);
    const loader = new MMDLoader(new THREE.LoadingManager());
    const vmdUrls = vmdFiles.map((file) => URL.createObjectURL(file));

    try {
      const source = (vmdUrls.length === 1 ? vmdUrls[0] : vmdUrls) as unknown as string;
      const clip = await new Promise<THREE.AnimationClip>((resolve, reject) => {
        loader.loadAnimation(source, animationTarget, (animation: any) => resolve(animation as THREE.AnimationClip), undefined, reject);
      });

      const mmdData = (animationTarget.geometry.userData as { MMD?: { rigidBodies?: unknown[]; constraints?: unknown[] } }).MMD;
      const hasPhysicsData = mmdData?.rigidBodies != null && Array.isArray(mmdData.rigidBodies) && mmdData.rigidBodies.length > 0;
      // eslint-disable-next-line no-console
      console.log('[MMD] Physics data check:', {
        hasRigidBodies: hasPhysicsData,
        rigidBodyCount: mmdData?.rigidBodies?.length ?? 0,
        constraintCount: mmdData?.constraints?.length ?? 0,
        physicsAvailable,
        mmdData,
      });
      const usePhysics = physicsAvailable && hasPhysicsData;
      // eslint-disable-next-line no-console
      console.log('[MMD] Using physics:', usePhysics);

      if (animationTarget instanceof THREE.SkinnedMesh) {
        animationTarget.pose();
        animationTarget.updateMatrixWorld(true);
      }

      const helper = new ThreeMMDAnimationHelper({ pmxAnimation: true, resetPhysicsOnLoop: true });
      helper.add(animationTarget, {
        animation: clip,
        physics: usePhysics,
        warmup: 60,
        unitStep: 1 / 65,
      });

      const helperState = helper.objects.get(animationTarget);
      if (usePhysics && helperState?.physics) {
        installMmdStageEnvironmentBridge(helper as Parameters<typeof installMmdStageEnvironmentBridge>[0], () => ({
          characters: charactersRef.current,
          defaultStageVisible: defaultStageVisibleRef.current,
        }));
      }

      const mixer = helperState?.mixer ?? null;
      const action = mixer ? mixer.clipAction(clip) : null;

      if (action) {
        action.enabled = true;
        action.clampWhenFinished = true;
        action.setLoop(THREE.LoopOnce, 1);
        action.play();
      }

      const initialTime = currentFrameRef.current / Math.max(fpsRef.current, 1);
      if (mixer) {
        mixer.setTime(initialTime);
      }

      helper.update(0);

      const fps = Math.max(fpsRef.current, 1);
      const durationFrames = Math.max(1, Math.floor(clip.duration * fps));
      setTimelineEndFrame(durationFrames);

      setCharacters((prev) => prev.map((char) => (
        char.id === charId
          ? {
            ...char,
            vmdFiles,
            vrmaFile: null,
            mmdMesh: animationTarget,
            mmdHelper: helper,
            vmdClip: clip,
            vrmaClip: null,
            mixer,
            action,
            durationFrames,
            physicsEnabled: !!helperState?.physics,
            loaded: true,
          }
          : char
      )));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load VMD motion';
      setErrorByCharId((prev) => ({ ...prev, [charId]: message }));
    } finally {
      vmdUrls.forEach((url) => URL.revokeObjectURL(url));
      setLoadingByCharId((prev) => ({ ...prev, [charId]: false }));
    }
  };

  const findFirstNamedBone = (target: THREE.SkinnedMesh, candidateNames: string[]) => {
    const byLower = new Map<string, THREE.Bone>();
    for (const bone of target.skeleton.bones) {
      byLower.set(bone.name.toLowerCase(), bone);
    }

    for (const name of candidateNames) {
      const bone = byLower.get(name.toLowerCase());
      if (bone) return bone;
    }

    const isIkLike = (name: string) => {
      const lower = name.toLowerCase();
      return lower.includes('ik') || lower.includes('ｉｋ') || lower.includes('ＩＫ'.toLowerCase());
    };

    // Fallback: best-effort fuzzy match.
    // Prefer non-IK deform bones over IK controllers, unless the candidate explicitly asks for IK.
    let best: { bone: THREE.Bone; score: number } | null = null;
    for (const bone of target.skeleton.bones) {
      const boneLower = bone.name.toLowerCase();
      for (const candidate of candidateNames) {
        const candLower = candidate.toLowerCase();
        if (!candLower) continue;
        if (!boneLower.includes(candLower)) continue;

        let score = 0;
        if (boneLower === candLower) score = 100;
        else if (boneLower.startsWith(candLower)) score = 80;
        else score = 50;

        const candWantsIk = candLower.includes('ik') || candLower.includes('ｉｋ') || candLower.includes('ＩＫ'.toLowerCase());
        if (!candWantsIk && isIkLike(bone.name)) {
          score -= 40;
        }

        if (!best || score > best.score) {
          best = { bone, score };
        }
      }
    }

    if (best) return best.bone;

    return null;
  };

  const createPmxClipFromVrmAnimation = (animationTarget: THREE.SkinnedMesh, vrmAnimation: unknown) => {
    const tracks: THREE.KeyframeTrack[] = [];
    const vrmAnim = vrmAnimation as {
      duration?: number;
      restHipsPosition?: THREE.Vector3;
      humanoidTracks?: {
        rotation?: Map<string, THREE.QuaternionKeyframeTrack>;
        translation?: Map<string, THREE.VectorKeyframeTrack>;
      };
    };

    const map: Record<string, string[]> = {
      // For PMX, translation/root motion is usually authored on センター / 全ての親.
      // We'll prefer those for VRMA hips translation.
      hips: ['全ての親', 'センター', '腰', 'hips', 'hip', 'pelvis'],
      spine: ['上半身', 'spine'],
      chest: ['上半身2', 'chest'],
      upperChest: ['上半身3', 'upperchest', 'upper_chest'],
      neck: ['首', 'neck'],
      head: ['頭', 'head'],
      leftShoulder: ['左肩', 'leftshoulder', 'l_shoulder', 'shoulder_l'],
      leftUpperArm: ['左腕', 'leftupperarm', 'l_arm', 'upperarm_l'],
      leftLowerArm: ['左ひじ', '左肘', 'leftlowerarm', 'l_elbow', 'lowerarm_l'],
      leftHand: ['左手首', 'lefthand', 'l_wrist', 'hand_l'],
      rightShoulder: ['右肩', 'rightshoulder', 'r_shoulder', 'shoulder_r'],
      rightUpperArm: ['右腕', 'rightupperarm', 'r_arm', 'upperarm_r'],
      rightLowerArm: ['右ひじ', '右肘', 'rightlowerarm', 'r_elbow', 'lowerarm_r'],
      rightHand: ['右手首', 'righthand', 'r_wrist', 'hand_r'],
      leftUpperLeg: ['左足', 'leftupperleg', 'l_leg', 'thigh_l'],
      leftLowerLeg: ['左ひざ', '左膝', 'leftlowerleg', 'l_knee', 'calf_l'],
      leftFoot: ['左足首', 'leftfoot', 'l_ankle', 'foot_l'],
      leftToes: ['左つま先', '左足先', 'lefttoes', 'toe_l'],
      rightUpperLeg: ['右足', 'rightupperleg', 'r_leg', 'thigh_r'],
      rightLowerLeg: ['右ひざ', '右膝', 'rightlowerleg', 'r_knee', 'calf_r'],
      rightFoot: ['右足首', 'rightfoot', 'r_ankle', 'foot_r'],
      rightToes: ['右つま先', '右足先', 'righttoes', 'toe_r'],
    };

    const rotationMap = vrmAnim.humanoidTracks?.rotation;
    if (rotationMap && typeof rotationMap.forEach === 'function') {
      rotationMap.forEach((origTrack: THREE.QuaternionKeyframeTrack, humanBoneName: string) => {
        const candidates = map[humanBoneName] ?? [humanBoneName];
        const targetBone = findFirstNamedBone(animationTarget, candidates);
        if (!targetBone) return;

        tracks.push(new THREE.QuaternionKeyframeTrack(
          `.bones[${targetBone.name}].quaternion`,
          origTrack.times,
          origTrack.values,
        ));
      });
    }

    const translationMap = vrmAnim.humanoidTracks?.translation;
    const hipsTrack = translationMap?.get?.('hips');
    if (hipsTrack) {
      const hipsBone = findFirstNamedBone(animationTarget, map.hips);
      if (hipsBone) {
        const restAnim = vrmAnim.restHipsPosition ?? new THREE.Vector3(0, 1, 0);
        const restTargetWorld = new THREE.Vector3();
        hipsBone.getWorldPosition(restTargetWorld);

        // Scale translation to match PMX rig height (same idea as three-vrm-animation’s createVRMAnimationClip).
        // Prevent division by near-zero rest hips height.
        const animY = Math.max(Math.abs(restAnim.y), 1e-4);
        const scale = restTargetWorld.y / animY;

        const baseLocal = hipsBone.position.clone();
        const values = new Float32Array(hipsTrack.values.length);

        for (let i = 0; i < hipsTrack.values.length; i += 3) {
          const x = hipsTrack.values[i] ?? 0;
          const y = hipsTrack.values[i + 1] ?? 0;
          const z = hipsTrack.values[i + 2] ?? 0;

          // Convert absolute-ish hips translation into a delta from the VRMA rest hips position,
          // then apply it onto the PMX center/root bone’s authored rest position.
          values[i] = baseLocal.x + (x - restAnim.x) * scale;
          values[i + 1] = baseLocal.y + (y - restAnim.y) * scale;
          values[i + 2] = baseLocal.z + (z - restAnim.z) * scale;
        }

        tracks.push(new THREE.VectorKeyframeTrack(
          `.bones[${hipsBone.name}].position`,
          hipsTrack.times,
          values,
        ));
      }
    }

    const duration = Number.isFinite(vrmAnim.duration) && (vrmAnim.duration ?? 0) > 0
      ? vrmAnim.duration
      : undefined;

    return new THREE.AnimationClip('VRMA->PMX', duration, tracks);
  };

  const collectMorphMeshes = (root: THREE.Object3D) => {
    const meshes: THREE.Mesh[] = [];
    root.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const dict = (child as unknown as { morphTargetDictionary?: Record<string, number> }).morphTargetDictionary;
        const influences = (child as unknown as { morphTargetInfluences?: number[] }).morphTargetInfluences;
        if (dict && influences && Array.isArray(influences) && influences.length > 0) {
          meshes.push(child);
        }
      }
    });
    return meshes;
  };

  const createPmxExpressionTracksFromVrmAnimation = (meshRoot: THREE.Object3D, vrmAnimation: unknown) => {
    const vrmAnim = vrmAnimation as {
      expressionTracks?: {
        preset?: Map<string, THREE.NumberKeyframeTrack>;
        custom?: Map<string, THREE.NumberKeyframeTrack>;
      };
    };

    const meshes = collectMorphMeshes(meshRoot);
    if (meshes.length === 0) return [];

    const presetAliases: Record<string, string[]> = {
      blink: ['blink', 'まばたき', '瞬き'],
      blinkLeft: ['blinkleft', 'winkl', 'ｳｨﾝｸ', 'ウィンク', 'ｳｨﾝｸ左', 'ウィンク左', 'wink_l', 'wink left'],
      blinkRight: ['blinkright', 'winkr', 'ｳｨﾝｸ右', 'ウィンク右', 'wink_r', 'wink right'],
      joy: ['joy', 'smile', '笑い', 'にこり'],
      angry: ['angry', '怒り'],
      sorrow: ['sorrow', 'sad', '悲しい', '困る'],
      fun: ['fun', 'happy'],
      a: ['a', 'あ'],
      i: ['i', 'い'],
      u: ['u', 'う'],
      e: ['e', 'え'],
      o: ['o', 'お'],
      lookUp: ['lookup', '上', '上見る', '見上げ'],
      lookDown: ['lookdown', '下', '下見る', '見下げ'],
      lookLeft: ['lookleft', '左', '左見る'],
      lookRight: ['lookright', '右', '右見る'],
      // Some PMX models use these
      neutral: ['neutral', '通常'],
    };

    const normalize = (s: string) => s.replace(/\s+/g, '').toLowerCase();

    const findMorphBinding = (mesh: THREE.Mesh, candidates: string[]) => {
      const dict = (mesh as unknown as { morphTargetDictionary?: Record<string, number> }).morphTargetDictionary ?? {};
      const byNorm = new Map<string, { key: string; index: number }>();
      for (const [key, index] of Object.entries(dict)) {
        byNorm.set(normalize(key), { key, index });
      }
      for (const c of candidates) {
        const hit = byNorm.get(normalize(c));
        if (hit) return hit;
      }
      // partial match fallback
      for (const [key, index] of Object.entries(dict)) {
        const nk = normalize(key);
        if (candidates.some((c) => nk.includes(normalize(c)))) {
          return { key, index };
        }
      }
      return null;
    };

    const tracks: THREE.KeyframeTrack[] = [];
    const preset = vrmAnim.expressionTracks?.preset;
    const custom = vrmAnim.expressionTracks?.custom;

    const appendTrackFor = (exprName: string, orig: THREE.NumberKeyframeTrack) => {
      const candidates = presetAliases[exprName] ?? [exprName];
      for (const mesh of meshes) {
        const binding = findMorphBinding(mesh, candidates);
        if (!binding) continue;
        if (!mesh.name) {
          mesh.name = `MorphMesh_${binding.key}`;
        }
        tracks.push(new THREE.NumberKeyframeTrack(
          `${mesh.name}.morphTargetInfluences[${binding.index}]`,
          orig.times,
          orig.values,
        ));
      }
    };

    preset?.forEach?.((orig, name) => appendTrackFor(name, orig));
    custom?.forEach?.((orig, name) => appendTrackFor(name, orig));

    return tracks;
  };

  const loadVrmaForCharacter = async (charId: number, nextVrmaFile?: File | null, meshOverride?: THREE.Object3D | null) => {
    const currentChar = charactersRef.current.find((char) => char.id === charId);
    const vrmaFile = nextVrmaFile ?? currentChar?.vrmaFile ?? null;
    const mesh = meshOverride ?? currentChar?.mesh ?? null;
    const animationTarget = mesh ? getMmdAnimationTarget(mesh) : null;

    if (!currentChar || !vrmaFile || !mesh || !animationTarget) {
      return;
    }

    setLoadingByCharId((prev) => ({ ...prev, [charId]: true }));
    setErrorByCharId((prev) => ({ ...prev, [charId]: undefined }));
    disposeCharacterAnimation(currentChar);

    const [{ GLTFLoader }, { VRMAnimationLoaderPlugin }, { MMDAnimationHelper: ThreeMMDAnimationHelper }, physicsAvailable] = await Promise.all([
      import('@three-jsm/loaders/GLTFLoader.js'),
      import('@pixiv/three-vrm-animation'),
      import('@three-mmd/animation/MMDAnimationHelper.js'),
      ensureAmmo(),
    ]);

    const vrmaUrl = URL.createObjectURL(vrmaFile);

    try {
      const loader = new GLTFLoader();
      loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
      const gltf = await new Promise<import('three/examples/jsm/loaders/GLTFLoader.js').GLTF>((resolve, reject) => {
        loader.load(vrmaUrl, resolve, undefined, reject);
      });

      const userData = gltf.userData as Record<string, unknown> | undefined;
      const vrmAnimations = (userData?.vrmAnimations as unknown[] | undefined) ?? [];
      const vrmAnimation = vrmAnimations[0] ?? null;
      if (!vrmAnimation) {
        throw new Error('No VRM animation data found in .vrma');
      }

      const clip = createPmxClipFromVrmAnimation(animationTarget, vrmAnimation);
      if (!clip || clip.tracks.length === 0) {
        throw new Error('VRMA loaded, but no compatible humanoid tracks matched this PMX skeleton');
      }

      const expressionTracks = createPmxExpressionTracksFromVrmAnimation(mesh, vrmAnimation);
      const mergedClip = expressionTracks.length > 0
        ? new THREE.AnimationClip(clip.name, clip.duration, [...clip.tracks, ...expressionTracks])
        : clip;

      const mmdData = (animationTarget.geometry.userData as { MMD?: { rigidBodies?: unknown[]; constraints?: unknown[] } }).MMD;
      const hasPhysicsData = mmdData?.rigidBodies != null && Array.isArray(mmdData.rigidBodies) && mmdData.rigidBodies.length > 0;
      const usePhysics = physicsAvailable && hasPhysicsData;

      if (animationTarget instanceof THREE.SkinnedMesh) {
        animationTarget.pose();
        animationTarget.updateMatrixWorld(true);
      }

      const helper = new ThreeMMDAnimationHelper({ pmxAnimation: true, resetPhysicsOnLoop: true });
      helper.add(animationTarget, {
        animation: mergedClip,
        physics: usePhysics,
        warmup: 60,
        unitStep: 1 / 65,
      });
      // VRMA provides FK bone rotations but not PMX IK target bone motion.
      // Leaving IK enabled can pin feet to the (static) IK targets, making them look locked.
      helper.enable('ik', false);

      const helperState = helper.objects.get(animationTarget);
      if (usePhysics && helperState?.physics) {
        installMmdStageEnvironmentBridge(helper as Parameters<typeof installMmdStageEnvironmentBridge>[0], () => ({
          characters: charactersRef.current,
          defaultStageVisible: defaultStageVisibleRef.current,
        }));
      }

      const mixer = helperState?.mixer ?? null;
      const action = mixer ? mixer.clipAction(mergedClip) : null;
      if (action) {
        action.enabled = true;
        action.clampWhenFinished = true;
        action.setLoop(THREE.LoopOnce, 1);
        action.play();
      }

      const initialTime = currentFrameRef.current / Math.max(fpsRef.current, 1);
      if (mixer) {
        seekMixerTo(mixer, initialTime);
      }
      helper.update(0);

      const fps = Math.max(fpsRef.current, 1);
      const durationFrames = Math.max(1, Math.floor(mergedClip.duration * fps));
      setTimelineEndFrame(durationFrames);

      setCharacters((prev) => prev.map((char) => (
        char.id === charId
          ? {
            ...char,
            vrmaFile,
            vrmaClip: mergedClip,
            vmdFiles: [],
            vmdClip: null,
            mmdMesh: animationTarget,
            mmdHelper: helper,
            mixer,
            action,
            durationFrames,
            physicsEnabled: !!helperState?.physics,
            loaded: true,
          }
          : char
      )));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load VRMA motion';
      setErrorByCharId((prev) => ({ ...prev, [charId]: message }));
    } finally {
      URL.revokeObjectURL(vrmaUrl);
      setLoadingByCharId((prev) => ({ ...prev, [charId]: false }));
    }
  };

  const getFirstSkinnedMesh = (object: THREE.Object3D) => {
    let target: THREE.SkinnedMesh | null = null;
    object.traverse((child) => {
      if (!target && child instanceof THREE.SkinnedMesh) {
        target = child;
      }
    });
    return target;
  };

  const loadFbxMotionForCharacter = async (charId: number, nextFbxMotionFile?: File | null, meshOverride?: THREE.Object3D | null) => {
    const currentChar = charactersRef.current.find((char) => char.id === charId);
    const fbxMotionFile = nextFbxMotionFile ?? currentChar?.fbxMotionFile ?? null;
    const mesh = meshOverride ?? currentChar?.mesh ?? null;
    const animationTarget = mesh ? getMmdAnimationTarget(mesh) : null;

    if (!currentChar || !fbxMotionFile || !mesh || !animationTarget) {
      return;
    }

    setLoadingByCharId((prev) => ({ ...prev, [charId]: true }));
    setErrorByCharId((prev) => ({ ...prev, [charId]: undefined }));
    disposeCharacterAnimation(currentChar);

    const [{ FBXLoader }, SkeletonUtils, { MMDAnimationHelper: ThreeMMDAnimationHelper }, physicsAvailable] = await Promise.all([
      import('@three-jsm/loaders/FBXLoader.js'),
      import('@three-jsm/utils/SkeletonUtils.js'),
      import('@three-mmd/animation/MMDAnimationHelper.js'),
      ensureAmmo(),
    ]);

    const url = URL.createObjectURL(fbxMotionFile);

    try {
      const loader = new FBXLoader();
      const fbx = await new Promise<THREE.Object3D>((resolve, reject) => {
        loader.load(url, (obj: any) => resolve(obj as THREE.Object3D), undefined, reject);
      });

      const srcSkinned = getFirstSkinnedMesh(fbx);
      const srcClip = (fbx as any).animations?.[0] as THREE.AnimationClip | undefined;

      if (!srcSkinned || !srcClip) {
        throw new Error('FBX motion must contain a skinned mesh with at least one animation clip');
      }

      // Retarget FBX skeleton animation onto PMX skeleton.
      const retargeted = SkeletonUtils.retargetClip(animationTarget, srcSkinned, srcClip, {
        preserveBoneMatrix: true,
        preserveHipPosition: true,
        useFirstFramePosition: true,
        hip: 'hip',
      }) as THREE.AnimationClip;

      const mmdData = (animationTarget.geometry.userData as { MMD?: { rigidBodies?: unknown[]; constraints?: unknown[] } }).MMD;
      const hasPhysicsData = mmdData?.rigidBodies != null && Array.isArray(mmdData.rigidBodies) && mmdData.rigidBodies.length > 0;
      const usePhysics = physicsAvailable && hasPhysicsData;

      if (animationTarget instanceof THREE.SkinnedMesh) {
        animationTarget.pose();
        animationTarget.updateMatrixWorld(true);
      }

      // Use MMDAnimationHelper so PMX IK and physics remain active.
      const helper = new ThreeMMDAnimationHelper({ pmxAnimation: true, resetPhysicsOnLoop: true });
      helper.add(animationTarget, {
        animation: retargeted,
        physics: usePhysics,
        warmup: 60,
        unitStep: 1 / 65,
      });

      const helperState = helper.objects.get(animationTarget);
      if (usePhysics && helperState?.physics) {
        installMmdStageEnvironmentBridge(helper as Parameters<typeof installMmdStageEnvironmentBridge>[0], () => ({
          characters: charactersRef.current,
          defaultStageVisible: defaultStageVisibleRef.current,
        }));
      }

      const mixer = helperState?.mixer ?? null;
      const action = mixer ? mixer.clipAction(retargeted) : null;

      if (action) {
        action.enabled = true;
        action.clampWhenFinished = true;
        action.setLoop(THREE.LoopOnce, 1);
        action.play();
      }

      const initialTime = currentFrameRef.current / Math.max(fpsRef.current, 1);
      if (mixer) {
        seekMixerTo(mixer, initialTime);
      }
      helper.update(0);

      const fps = Math.max(fpsRef.current, 1);
      const durationFrames = Math.max(1, Math.floor(retargeted.duration * fps));
      setTimelineEndFrame(durationFrames);

      setCharacters((prev) => prev.map((char) => (
        char.id === charId
          ? {
            ...char,
            fbxMotionFile,
            fbxClip: retargeted,
            vmdFiles: [],
            vmdClip: null,
            vrmaFile: null,
            vrmaClip: null,
            mmdMesh: animationTarget,
            mmdHelper: helper,
            mixer,
            action,
            durationFrames,
            physicsEnabled: !!helperState?.physics,
            loaded: true,
          }
          : char
      )));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load FBX motion';
      setErrorByCharId((prev) => ({ ...prev, [charId]: message }));
    } finally {
      URL.revokeObjectURL(url);
      setLoadingByCharId((prev) => ({ ...prev, [charId]: false }));
    }
  };

  const loadBvhMotionForCharacter = async (charId: number, nextBvhMotionFile?: File | null, meshOverride?: THREE.Object3D | null) => {
    const currentChar = charactersRef.current.find((char) => char.id === charId);
    const bvhMotionFile = nextBvhMotionFile ?? currentChar?.bvhMotionFile ?? null;
    const mesh = meshOverride ?? currentChar?.mesh ?? null;
    const animationTarget = mesh ? getMmdAnimationTarget(mesh) : null;

    if (!currentChar || !bvhMotionFile || !mesh || !animationTarget) {
      return;
    }

    setLoadingByCharId((prev) => ({ ...prev, [charId]: true }));
    setErrorByCharId((prev) => ({ ...prev, [charId]: undefined }));
    disposeCharacterAnimation(currentChar);

    const [{ BVHLoader }, SkeletonUtils, { MMDAnimationHelper: ThreeMMDAnimationHelper }, physicsAvailable] = await Promise.all([
      import('@three-jsm/loaders/BVHLoader.js'),
      import('@three-jsm/utils/SkeletonUtils.js'),
      import('@three-mmd/animation/MMDAnimationHelper.js'),
      ensureAmmo(),
    ]);

    const url = URL.createObjectURL(bvhMotionFile);

    try {
      const loader = new BVHLoader();
      const result = await new Promise<{ skeleton: THREE.Skeleton; clip: THREE.AnimationClip }>((resolve, reject) => {
        loader.load(url, (res: any) => resolve(res as { skeleton: THREE.Skeleton; clip: THREE.AnimationClip }), undefined, reject);
      });

      const srcSkeleton = result.skeleton;
      const srcClip = result.clip;

      const retargeted = SkeletonUtils.retargetClip(animationTarget, srcSkeleton, srcClip, {
        preserveBoneMatrix: true,
        preserveHipPosition: true,
        useFirstFramePosition: true,
        hip: 'hip',
      }) as THREE.AnimationClip;

      const mmdData = (animationTarget.geometry.userData as { MMD?: { rigidBodies?: unknown[]; constraints?: unknown[] } }).MMD;
      const hasPhysicsData = mmdData?.rigidBodies != null && Array.isArray(mmdData.rigidBodies) && mmdData.rigidBodies.length > 0;
      const usePhysics = physicsAvailable && hasPhysicsData;

      if (animationTarget instanceof THREE.SkinnedMesh) {
        animationTarget.pose();
        animationTarget.updateMatrixWorld(true);
      }

      const helper = new ThreeMMDAnimationHelper({ pmxAnimation: true, resetPhysicsOnLoop: true });
      helper.add(animationTarget, {
        animation: retargeted,
        physics: usePhysics,
        warmup: 60,
        unitStep: 1 / 65,
      });

      const helperState = helper.objects.get(animationTarget);
      if (usePhysics && helperState?.physics) {
        installMmdStageEnvironmentBridge(helper as Parameters<typeof installMmdStageEnvironmentBridge>[0], () => ({
          characters: charactersRef.current,
          defaultStageVisible: defaultStageVisibleRef.current,
        }));
      }

      const mixer = helperState?.mixer ?? null;
      const action = mixer ? mixer.clipAction(retargeted) : null;
      if (action) {
        action.enabled = true;
        action.clampWhenFinished = true;
        action.setLoop(THREE.LoopOnce, 1);
        action.play();
      }

      const initialTime = currentFrameRef.current / Math.max(fpsRef.current, 1);
      if (mixer) {
        seekMixerTo(mixer, initialTime);
      }
      helper.update(0);

      const fps = Math.max(fpsRef.current, 1);
      const durationFrames = Math.max(1, Math.floor(retargeted.duration * fps));
      setTimelineEndFrame(durationFrames);

      setCharacters((prev) => prev.map((char) => (
        char.id === charId
          ? {
            ...char,
            bvhMotionFile,
            bvhClip: retargeted,
            vmdFiles: [],
            vmdClip: null,
            vrmaFile: null,
            vrmaClip: null,
            fbxMotionFile: null,
            fbxClip: null,
            mmdMesh: animationTarget,
            mmdHelper: helper,
            mixer,
            action,
            durationFrames,
            physicsEnabled: !!helperState?.physics,
            loaded: true,
          }
          : char
      )));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load BVH motion';
      setErrorByCharId((prev) => ({ ...prev, [charId]: message }));
    } finally {
      URL.revokeObjectURL(url);
      setLoadingByCharId((prev) => ({ ...prev, [charId]: false }));
    }
  };

  // Load PMX model for a character (like loadPMXFromFile in nms.html)
  const loadPMXForCharacter = async (
    charId: number,
    nextModelFile?: File | null,
    nextTexFiles?: File[],
    nextVmdFiles?: File[],
    nextVrmaFile?: File | null,
    nextFbxMotionFile?: File | null,
    nextBvhMotionFile?: File | null,
  ) => {
    const currentChar = charactersRef.current.find((char) => char.id === charId);
    const modelFile = nextModelFile ?? currentChar?.modelFile ?? null;
    const texFiles = nextTexFiles ?? currentChar?.texFiles ?? [];
    const vmdFiles = nextVmdFiles ?? currentChar?.vmdFiles ?? [];
    const vrmaFile = nextVrmaFile ?? currentChar?.vrmaFile ?? null;
    const fbxMotionFile = nextFbxMotionFile ?? currentChar?.fbxMotionFile ?? null;
    const bvhMotionFile = nextBvhMotionFile ?? currentChar?.bvhMotionFile ?? null;

    if (!currentChar || !modelFile) {
      return;
    }

    setLoadingByCharId((prev) => ({ ...prev, [charId]: true }));
    setErrorByCharId((prev) => ({ ...prev, [charId]: undefined }));
    disposeCharacterAnimation(currentChar);

    texFiles.forEach(registerTextureFile);

    const blobUrl = `${URL.createObjectURL(modelFile)}#${modelFile.name}`;
    const { MMDLoader } = await import('@three-mmd/loaders/MMDLoader.js');
    const loadingManager = new THREE.LoadingManager();
    loadingManager.setURLModifier(resolveTextureUrl);

    try {
      const loader = new MMDLoader(loadingManager);
      const mesh = await new Promise<THREE.Object3D>((resolve, reject) => {
        loader.load(blobUrl, (object: any) => resolve(object as THREE.Object3D), undefined, reject);
      });

      // Preserve authored transform for both characters and stages so synchronized assets stay aligned.

      mesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      setCharacters((prev) => prev.map((char) => {
        if (char.id !== charId) {
          return char;
        }

        if (char.mesh && char.mesh.parent === char.group) {
          char.group.remove(char.mesh);
        }

        char.group.add(mesh);
        applyCharTx(char.group, char.tx);

        return {
          ...char,
          modelFile,
          texFiles,
          vmdFiles,
          vrmaFile,
          fbxMotionFile,
          bvhMotionFile,
          mesh,
          mmdMesh: null,
          mmdHelper: null,
          vmdClip: null,
          vrmaClip: null,
          fbxClip: null,
          bvhClip: null,
          mixer: null,
          action: null,
          durationFrames: 0,
          physicsEnabled: false,
          loaded: false,
        };
      }));

      if (vmdFiles.length > 0) {
        await loadVmdForCharacter(charId, vmdFiles, mesh);
      } else if (vrmaFile) {
        await loadVrmaForCharacter(charId, vrmaFile, mesh);
      } else if (fbxMotionFile) {
        await loadFbxMotionForCharacter(charId, fbxMotionFile, mesh);
      } else if (bvhMotionFile) {
        await loadBvhMotionForCharacter(charId, bvhMotionFile, mesh);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load PMX/PMD model';
      setErrorByCharId((prev) => ({ ...prev, [charId]: message }));
    } finally {
      URL.revokeObjectURL(blobUrl.split('#')[0]);
      setLoadingByCharId((prev) => ({ ...prev, [charId]: false }));
    }
  };

  const handleModelUpload = async (event: ChangeEvent<HTMLInputElement>, charId: number) => {
    const files = event.target.files;
    const modelFile = files ? Array.from(files).find((file) => /\.(pmx|pmd)$/i.test(file.name)) ?? null : null;

    event.target.value = '';

    if (!modelFile) {
      setErrorByCharId((prev) => ({ ...prev, [charId]: 'Select a .pmx or .pmd model file' }));
      return;
    }

    const currentChar = charactersRef.current.find((char) => char.id === charId);
    const texFiles = currentChar?.texFiles ?? [];

    if (currentChar) {
      disposeCharacterAnimation(currentChar);
    }

    setCharacters((prev) => prev.map((char) => {
      if (char.id !== charId) {
        return char;
      }

      if (char.mesh && char.mesh.parent === char.group) {
        char.group.remove(char.mesh);
      }

      return {
        ...char,
        modelFile,
        mesh: null,
        mmdMesh: null,
        mmdHelper: null,
        vmdClip: null,
        vrmaFile: null,
        vrmaClip: null,
        fbxMotionFile: null,
        fbxClip: null,
        bvhMotionFile: null,
        bvhClip: null,
        mixer: null,
        action: null,
        durationFrames: 0,
        physicsEnabled: false,
        loaded: false,
      };
    }));

    setSelectedCharId(charId);

    await loadPMXForCharacter(charId, modelFile, texFiles);
  };

  // Handle folder upload - auto discovers PMX and textures
  const handleFolderUpload = async (event: ChangeEvent<HTMLInputElement>, charId: number) => {
    const files = event.target.files;
    
    if (!files || files.length === 0) {
      return;
    }

    event.target.value = '';

    // Debug: Log all files found
    // eslint-disable-next-line no-console
    console.log('[Folder Upload] Files found:', Array.from(files).map(f => ({
      name: f.name,
      path: (f as File & { webkitRelativePath?: string }).webkitRelativePath,
      size: f.size
    })));

    const discovered = discoverModelsFromFolder(files);
    
    // Debug: Log discovery result
    // eslint-disable-next-line no-console
    console.log('[Folder Upload] Discovered models:', discovered.map(m => ({
      name: m.name,
      pmxFile: m.pmxFile.name,
      textureCount: m.textureFiles.length
    })));
    
    if (discovered.length === 0) {
      setErrorByCharId((prev) => ({ ...prev, [charId]: 'No PMX/PMD model found in folder' }));
      return;
    }

    // Use the first discovered model
    const model = discovered[0];
    const currentChar = charactersRef.current.find((char) => char.id === charId);

    if (!currentChar) {
      return;
    }

    if (currentChar) {
      disposeCharacterAnimation(currentChar);
    }

    setCharacters((prev) => prev.map((char) => {
      if (char.id !== charId) {
        return char;
      }

      if (char.mesh && char.mesh.parent === char.group) {
        char.group.remove(char.mesh);
      }

      return {
        ...char,
        modelFile: model.pmxFile,
        texFiles: model.textureFiles,
        mesh: null,
        mmdMesh: null,
        mmdHelper: null,
        vmdClip: null,
        vrmaFile: null,
        vrmaClip: null,
        mixer: null,
        action: null,
        durationFrames: 0,
        physicsEnabled: false,
        loaded: false,
      };
    }));

    setSelectedCharId(charId);

    // Auto-load the model with discovered textures
    await loadPMXForCharacter(charId, model.pmxFile, model.textureFiles);
  };

  // Handle ZIP upload - extract and discover models
  const handleZipUpload = async (event: ChangeEvent<HTMLInputElement>, charId: number) => {
    const files = event.target.files;
    
    if (!files || files.length === 0) {
      return;
    }

    const zipFile = files[0];
    
    if (!zipFile.name.toLowerCase().endsWith('.zip')) {
      setErrorByCharId((prev) => ({ ...prev, [charId]: 'Please select a ZIP file' }));
      event.target.value = '';
      return;
    }

    event.target.value = '';
    setLoadingByCharId((prev) => ({ ...prev, [charId]: true }));

    try {
      const discovered = await extractAndDiscoverFromZip(zipFile);
      
      if (discovered.length === 0) {
        setErrorByCharId((prev) => ({ ...prev, [charId]: 'No PMX/PMD model found in ZIP' }));
        setLoadingByCharId((prev) => ({ ...prev, [charId]: false }));
        return;
      }

      // Use the first discovered model
      const model = discovered[0];
      const currentChar = charactersRef.current.find((char) => char.id === charId);

      if (!currentChar) {
        setLoadingByCharId((prev) => ({ ...prev, [charId]: false }));
        return;
      }

      if (currentChar) {
        disposeCharacterAnimation(currentChar);
      }

      setCharacters((prev) => prev.map((char) => {
        if (char.id !== charId) {
          return char;
        }

        if (char.mesh && char.mesh.parent === char.group) {
          char.group.remove(char.mesh);
        }

        return {
          ...char,
          modelFile: model.pmxFile,
          texFiles: model.textureFiles,
          mesh: null,
          mmdMesh: null,
          mmdHelper: null,
          vmdClip: null,
          vrmaFile: null,
          vrmaClip: null,
          mixer: null,
          action: null,
          durationFrames: 0,
          physicsEnabled: false,
          loaded: false,
        };
      }));

      setSelectedCharId(charId);

      // Auto-load the model with discovered textures
      await loadPMXForCharacter(charId, model.pmxFile, model.textureFiles);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to extract ZIP';
      setErrorByCharId((prev) => ({ ...prev, [charId]: message }));
    } finally {
      setLoadingByCharId((prev) => ({ ...prev, [charId]: false }));
    }
  };
  const handleTextureUpload = async (event: ChangeEvent<HTMLInputElement>, charId: number) => {
    const files = event.target.files;

    if (!files || files.length === 0) {
      return;
    }

    const nextTexFiles = Array.from(files);
    const currentChar = charactersRef.current.find((char) => char.id === charId);

    event.target.value = '';

    if (!currentChar) {
      return;
    }

    setCharacters((prev) => prev.map((char) => (
      char.id === charId
        ? { ...char, texFiles: nextTexFiles, loaded: false }
        : char
    )));

    if (currentChar.modelFile) {
      await loadPMXForCharacter(charId, currentChar.modelFile, nextTexFiles);
    }
  };

  const handleVmdUpload = async (event: ChangeEvent<HTMLInputElement>, charId: number) => {
    const files = event.target.files;
    const fileList = files ? Array.from(files) : [];
    const nextVrmaFile = fileList.find((file) => /\.vrma$/i.test(file.name)) ?? null;
    const nextFbxMotionFile = (!nextVrmaFile ? (fileList.find((file) => /\.fbx$/i.test(file.name)) ?? null) : null);
    const nextBvhMotionFile = (!nextVrmaFile && !nextFbxMotionFile ? (fileList.find((file) => /\.bvh$/i.test(file.name)) ?? null) : null);
    const nextVmdFiles = (nextVrmaFile || nextFbxMotionFile || nextBvhMotionFile) ? [] : fileList.filter((file) => /\.vmd$/i.test(file.name));
    const currentChar = charactersRef.current.find((char) => char.id === charId);

    event.target.value = '';

    if (!currentChar) {
      return;
    }

    disposeCharacterAnimation(currentChar);

    setCharacters((prev) => prev.map((char) => (
      char.id === charId
        ? {
          ...char,
          vmdFiles: nextVmdFiles,
          vrmaFile: nextVrmaFile,
          fbxMotionFile: nextFbxMotionFile,
          bvhMotionFile: nextBvhMotionFile,
          mmdMesh: null,
          mmdHelper: null,
          vmdClip: null,
          vrmaClip: null,
          fbxClip: null,
          bvhClip: null,
          mixer: null,
          action: null,
          durationFrames: 0,
          physicsEnabled: false,
          loaded: false,
        }
        : char
    )));

    if (nextVmdFiles.length === 0 && !nextVrmaFile && !nextFbxMotionFile && !nextBvhMotionFile) {
      return;
    }

    if (currentChar.mesh) {
      if (nextVrmaFile) {
        await loadVrmaForCharacter(charId, nextVrmaFile, currentChar.mesh);
      } else if (nextFbxMotionFile) {
        await loadFbxMotionForCharacter(charId, nextFbxMotionFile, currentChar.mesh);
      } else if (nextBvhMotionFile) {
        await loadBvhMotionForCharacter(charId, nextBvhMotionFile, currentChar.mesh);
      } else {
        await loadVmdForCharacter(charId, nextVmdFiles, currentChar.mesh);
      }
      return;
    }

    if (currentChar.modelFile && currentChar.texFiles.length > 0) {
      await loadPMXForCharacter(charId, currentChar.modelFile, currentChar.texFiles, nextVmdFiles, nextVrmaFile, nextFbxMotionFile, nextBvhMotionFile);
    }
  };

  const updateCharacterTransform = (charId: number, axis: keyof Character['tx'], value: number) => {
    setCharacters((prev) => prev.map((char) => {
      if (char.id !== charId) {
        return char;
      }

      const tx = { ...char.tx, [axis]: value };
      applyCharTx(char.group, tx);

      return {
        ...char,
        tx,
      };
    }));
  };

  const handleTogglePhysics = async (charId: number, charArg?: Character) => {
    const char = charArg ?? charactersRef.current.find((c) => c.id === charId);

    // eslint-disable-next-line no-console
    console.log('[Physics Toggle] Attempting toggle:', {
      hasChar: !!char,
      hasMmdHelper: !!char?.mmdHelper,
      hasMmdMesh: !!char?.mmdMesh,
      physicsEnabled: char?.physicsEnabled,
    });

    if (!char?.mmdHelper || !char.mmdMesh) {
      // eslint-disable-next-line no-console
      console.log('[Physics Toggle] Early return - missing helper or mesh');
      return;
    }

    const newState = !char.physicsEnabled;
    const currentHelperState = char.mmdHelper.objects.get(char.mmdMesh);
    const hasInitializedPhysics = !!currentHelperState?.physics;
    // eslint-disable-next-line no-console
    console.log('[Physics Toggle] New state:', newState);

    // If turning physics on and it wasn't enabled initially, we need to re-initialize
    if (newState && !char.physicsEnabled) {
      if (hasInitializedPhysics) {
        char.mmdHelper.enable('physics', true);

        setCharacters((prev) => prev.map((c) => (
          c.id === charId
            ? { ...c, physicsEnabled: true }
            : c
        )));
        return;
      }

      const physicsAvailable = await ensureAmmo();
      // eslint-disable-next-line no-console
      console.log('[Physics Toggle] Physics available:', physicsAvailable);
      if (!physicsAvailable) {
        setErrorByCharId((prev) => ({ ...prev, [charId]: 'Physics library (Ammo.js) failed to load. Check console for details.' }));
        return;
      }

      // Re-initialize the animation with physics enabled
      const { MMDAnimationHelper: ThreeMMDAnimationHelper } = await import('@three-mmd/animation/MMDAnimationHelper.js');
      const clip = char.vmdClip;

      // eslint-disable-next-line no-console
      console.log('[Physics Toggle] Re-initializing with physics:', { hasClip: !!clip, hasMesh: !!char.mmdMesh });

      if (clip && char.mmdMesh) {
        if (char.mmdMesh instanceof THREE.SkinnedMesh) {
          char.mmdMesh.pose();
          char.mmdMesh.updateMatrixWorld(true);
        }

        // Remove from old helper first
        try {
          const prevState = char.mmdHelper.objects.get(char.mmdMesh);
          if (prevState?.physics) {
            clearMmdStageColliders(prevState.physics);
          }
          char.mmdHelper.remove(char.mmdMesh);
        } catch {
          // Ignore errors if remove fails
        }

        // Create new helper with physics enabled
        const newHelper = new ThreeMMDAnimationHelper({ pmxAnimation: true, resetPhysicsOnLoop: true });
        newHelper.add(char.mmdMesh, {
          animation: clip,
          physics: true,
          warmup: 60,
          unitStep: 1 / 65,
        });

        const helperState = newHelper.objects.get(char.mmdMesh);
        if (helperState?.physics) {
          installMmdStageEnvironmentBridge(newHelper as Parameters<typeof installMmdStageEnvironmentBridge>[0], () => ({
            characters: charactersRef.current,
            defaultStageVisible: defaultStageVisibleRef.current,
          }));
        }

        const mixer = helperState?.mixer ?? null;
        const action = mixer ? mixer.clipAction(clip) : null;

        if (mixer) {
          mixer.setTime(0);
        }

        if (action) {
          action.enabled = true;
          action.clampWhenFinished = true;
          action.setLoop(THREE.LoopOnce, 1);
          action.play();
        }

        newHelper.update(0);

        setCharacters((prev) => prev.map((c) => (
          c.id === charId
            ? {
              ...c,
              mmdHelper: newHelper,
              mixer,
              action,
              physicsEnabled: true,
            }
            : c
        )));
        return;
      }
    }

    // Simple toggle for when physics was already initialized
    char.mmdHelper.enable('physics', newState);

    setCharacters((prev) => prev.map((c) => (
      c.id === charId
        ? { ...c, physicsEnabled: newState }
        : c
    )));
  };

  const getStatusText = (char: Character) => {
    if (loadingByCharId[char.id]) {
      return { text: 'Loading preview...', icon: <Loader2 className="w-3 h-3 animate-spin" />, color: 'text-blue-400' };
    }

    if (errorByCharId[char.id]) {
      return { text: errorByCharId[char.id], icon: <AlertCircle className="w-3 h-3" />, color: 'text-red-400' };
    }

    if (char.loaded && (char.vmdClip || char.vrmaClip || char.fbxClip)) {
      return { text: `Motion ready · ${char.durationFrames}f${char.physicsEnabled ? ' · physics' : ' · IK'}`, icon: <Film className="w-3 h-3" />, color: 'text-emerald-400' };
    }

    if (char.mesh) {
      const hasMotionSelected = char.vmdFiles.length > 0 || !!char.vrmaFile || !!char.fbxMotionFile || !!char.bvhMotionFile;
      return hasMotionSelected
        ? { text: char.vrmaFile ? 'VRMA selected' : (char.fbxMotionFile ? 'FBX motion selected' : (char.bvhMotionFile ? 'BVH motion selected' : 'VMD selected')), icon: <PlaySquare className="w-3 h-3" />, color: 'text-violet-400' }
        : { text: 'Preview loaded', icon: <Camera className="w-3 h-3" />, color: 'text-violet-400' };
    }

    if (char.modelFile && char.texFiles.length > 0) {
      return { text: 'Model + textures ready', icon: <Package className="w-3 h-3" />, color: 'text-amber-400' };
    }

    if (char.modelFile) {
      return { text: 'Model loaded — add textures', icon: <Box className="w-3 h-3" />, color: 'text-amber-400' };
    }

    return { text: 'Waiting for model', icon: <Layers className="w-3 h-3" />, color: 'text-gray-500' };
  };

  const removeCharacter = (charId: number) => {
    setCharacters((prev) => {
      const target = prev.find((char) => char.id === charId);

      if (target) {
        disposeCharacterAnimation(target);
      }

      if (target?.mesh && target.mesh.parent === target.group) {
        target.group.remove(target.mesh);
      }

      if (sceneRef.current && target) {
        sceneRef.current.remove(target.group);
      }

      return prev.filter((char) => char.id !== charId);
    });

    setErrorByCharId((prev) => {
      const next = { ...prev };
      delete next[charId];
      return next;
    });

    setLoadingByCharId((prev) => {
      const next = { ...prev };
      delete next[charId];
      return next;
    });

    if (selectedCharId === charId) {
      setSelectedCharId(null);
    }
  };

  const timelineTracks: TimelineTrack[] = [
    // Camera Tracks
    ...cameras.map((cam) => {
      const motionName = cam.vmdFile ? cam.vmdFile.name : 'No VMD selected';
      return {
        id: `camera-${cam.id}`,
        label: cam.name,
        subtitle: cam.vmdClip ? `${motionName} · ${cam.durationFrames}f` : motionName,
        startFrame: 0,
        endFrame: cam.durationFrames,
        active: !!cam.vmdClip,
        accentClassName: 'border-blue-400/70 bg-blue-400/20',
      };
    }),
    
    // Character and Stage Tracks
    ...characters.map((char, index) => {
      const baseName = char.type === 'stage' ? `Stage ${char.id + 1}` : `Character ${char.id + 1}`;
      const name = char.modelFile ? char.modelFile.name.replace(/\.(pmx|pmd)$/i, '') : baseName;
      const motionName = char.vrmaFile
        ? char.vrmaFile.name
        : (char.fbxMotionFile
          ? char.fbxMotionFile.name
          : (char.bvhMotionFile
            ? char.bvhMotionFile.name
            : (char.vmdFiles.length > 0 ? char.vmdFiles.map((file) => file.name).join(', ') : 'No motion selected')));
      const accentClassName = char.type === 'stage' 
        ? 'border-orange-400/70 bg-orange-400/20'
        : [
            'border-sky-400/70 bg-sky-400/20',
            'border-emerald-400/70 bg-emerald-400/20',
            'border-fuchsia-400/70 bg-fuchsia-400/20',
            'border-amber-400/70 bg-amber-400/20',
          ][index % 4];

      return {
        id: `char-${char.id}`,
        label: name,
        subtitle: (char.vmdClip || char.vrmaClip || char.fbxClip || char.bvhClip) ? `${motionName} · ${char.durationFrames}f` : motionName,
        startFrame: 0,
        endFrame: char.durationFrames,
        active: !!char.action && !!(char.vmdClip || char.vrmaClip || char.fbxClip || char.bvhClip),
        accentClassName,
      };
    })
  ];

  const canPlay = characters.some((char) => char.action && char.durationFrames > 0) || cameras.some(c => c.vmdClip && c.durationFrames > 0);
  const handleFrameChange = (frame: number) => {
    const clamped = Math.min(Math.max(frame, 0), Math.max(timelineEndFrame, 1));
    isPlayingRef.current = false;
    setIsPlaying(false);
    currentFrameRef.current = clamped;
    playbackTimeRef.current = clamped / Math.max(fpsRef.current, 1);
    setCurrentFrame(clamped);
    syncAllToFrame(clamped, { resetPhysics: !isTimelineScrubbingRef.current });
  };
  const handleStepFrame = (delta: number) => {
    isPlayingRef.current = false;
    setIsPlaying(false);
    setCurrentFrame((prev) => {
      const next = Math.min(Math.max(Math.round(prev) + delta, 0), Math.max(timelineEndFrame, 1));
      currentFrameRef.current = next;
      playbackTimeRef.current = next / Math.max(fpsRef.current, 1);
      syncAllToFrame(next);
      return next;
    });
  };
  const handleScrubStart = () => {
    isTimelineScrubbingRef.current = true;
  };
  const handleScrubEnd = () => {
    isTimelineScrubbingRef.current = false;
    syncAllToFrame(currentFrameRef.current, { resetPhysics: true });
  };
  const handleStopPlayback = () => {
    isPlayingRef.current = false;
    setIsPlaying(false);
    currentFrameRef.current = 0;
    playbackTimeRef.current = 0;
    setCurrentFrame(0);
    syncAllToFrame(0, { resetPhysics: true });
  };
  const handleFpsChange = (nextFps: number) => {
    setFps(Math.min(Math.max(Math.round(nextFps), 1), 120));
  };

  const updateViewportEffect = <K extends keyof ViewportEffects>(key: K, value: ViewportEffects[K]) => {
    setViewportEffects((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const applyEffectsPreset = (presetKey: EffectsPresetKey) => {
    const preset = EFFECTS_PRESETS[presetKey];
    if (!preset) return;
    if (presetKey === 'default') {
      setViewportEffects({ ...defaultViewportEffects });
      return;
    }
    // Anchor on full defaults so Partial preset merges never leave strength keys undefined (NaN% in UI).
    setViewportEffects({
      ...defaultViewportEffects,
      ...preset.effects,
    });
  };

  const updateExportSetting = <K extends keyof ExportSettings>(key: K, value: ExportSettings[K]) => {
    setExportSettings((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleExportAspectPreset = (preset: ExportAspectPreset) => {
    const presetDimensions = EXPORT_ASPECT_PRESETS[preset];
    setExportSettings((prev) => ({
      ...prev,
      aspectPreset: preset,
      width: presetDimensions.width,
      height: presetDimensions.height,
    }));
  };

  const runZipExport = async (frameCount: number, options: {
    progressLabel: string;
    filePrefix: string;
    completionLabel: string;
  }) => {
    if (isExporting || exportInFlightRef.current) {
      return;
    }

    if (!sceneCaptureApiRef.current) {
      setExportStatus('Renderer is not ready yet.');
      return;
    }

    const safeFrameCount = Math.max(1, Math.round(frameCount));
    const exportFps = Math.max(1, Math.round(exportSettings.fps));
    const exportWidth = Math.max(2, Math.round(exportSettings.width));
    const exportHeight = Math.max(2, Math.round(exportSettings.height));

    const previousFrame = currentFrameRef.current;
    const previousPlaybackTime = playbackTimeRef.current;
    const wasPlaying = isPlayingRef.current;

    // Disable frustum culling on all character meshes during export.
    // SkinnedMesh bounding spheres are computed from bind pose, not
    // the animated pose, so Three.js can incorrectly cull characters
    // when the export aspect ratio changes the frustum shape.
    const savedFrustumCulled = new Map<THREE.Object3D, boolean>();

    try {
      exportInFlightRef.current = true;
      isPlayingRef.current = false;
      setIsPlaying(false);

      setIsExporting(true);
      setExportProgress(0);
      setExportStatus('Preparing export...');

      const captureApi = sceneCaptureApiRef.current;
      if (!captureApi) {
        throw new Error('Capture API is unavailable.');
      }

      // Pause the main render loop during capture to prevent physics desync
      captureApi.setPaused(true);

      charactersRef.current.forEach((char) => {
        if (char.group) {
          char.group.traverse((obj) => {
            if ((obj as THREE.Mesh).isMesh) {
              savedFrustumCulled.set(obj, obj.frustumCulled);
              obj.frustumCulled = false;
            }
          });
        }
      });

      const timelineFps = Math.max(fpsRef.current, 1);
      const timelineStepSeconds = 1 / timelineFps;
      let lastCapturedFrame = -1;

      const zipBlob = await exportPngSequenceToZip({
        frameCount: safeFrameCount,
        fps: exportFps,
        onProgress: (value) => {
          setExportProgress(value);
          setExportStatus(`${options.progressLabel} ${Math.round(value * 100)}%`);
        },
        getFrame: async (frameIndex) => {
          const isFirstFrame = frameIndex === 0;
          const isSequentialFrame = frameIndex === lastCapturedFrame + 1;

          currentFrameRef.current = frameIndex;
          playbackTimeRef.current = frameIndex / timelineFps;
          setCurrentFrame(frameIndex);

          if (isSequentialFrame && !isFirstFrame) {
            // Incremental update: advance animation + IK + physics together
            // through the helper, exactly as live playback does.
            charactersRef.current.forEach((char) => {
              if (char.mmdHelper) {
                char.mmdHelper.update(timelineStepSeconds);
              } else if (char.mixer) {
                char.mixer.update(timelineStepSeconds);
              }
            });
          } else {
            // First frame or non-sequential: absolute seek with physics reset.
            syncAllToFrame(frameIndex, {
              resetPhysics: true,
            });
          }

          // Camera: always seek absolutely (no physics, safe to seek).
          if (mmdCameraHelperRef.current && boundMmdCameraRef.current) {
            const camTime = frameIndex / timelineFps;
            const helperState = mmdCameraHelperRef.current.objects.get(boundMmdCameraRef.current);
            if (helperState?.mixer) {
              seekMixerTo(helperState.mixer, camTime);
            }
            mmdCameraHelperRef.current.update(0);
          }

          lastCapturedFrame = frameIndex;
          return captureApi.capturePngFrame(exportWidth, exportHeight);
        },
      });

      const downloadUrl = URL.createObjectURL(zipBlob);
      const anchor = document.createElement('a');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      anchor.href = downloadUrl;
      anchor.download = `${options.filePrefix}-${exportWidth}x${exportHeight}-${stamp}.zip`;
      anchor.click();
      URL.revokeObjectURL(downloadUrl);

      setExportStatus(options.completionLabel);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Export failed.';
      setExportStatus(`Export failed: ${message}`);
    } finally {
      // Restore frustum culling
      savedFrustumCulled.forEach((value, obj) => { obj.frustumCulled = value; });

      // Resume the main render loop
      sceneCaptureApiRef.current?.setPaused(false);

      currentFrameRef.current = previousFrame;
      playbackTimeRef.current = previousPlaybackTime;
      syncAllToFrame(previousFrame, { resetPhysics: true });
      setCurrentFrame(previousFrame);

      if (wasPlaying) {
        isPlayingRef.current = true;
        setIsPlaying(true);
      }

      exportInFlightRef.current = false;
      setIsExporting(false);
      setExportProgress(0);
    }
  };

  const handleTabChange = (tab: 'characters' | 'cameras' | 'scene' | 'effects' | 'export') => {
    if (isExporting || exportInFlightRef.current) {
      return;
    }
    setActiveTab(tab);
  };

  const handleExportVideo = async () => {
    const allFrameCount = Math.max(1, Math.round(timelineEndFrameRef.current) + 1);
    await runZipExport(allFrameCount, {
      progressLabel: 'Capturing PNG frames',
      filePrefix: 'export',
      completionLabel: 'Full export complete. ZIP download started.',
    });
  };

  const handleExportFirstFrame = async () => {
    await runZipExport(1, {
      progressLabel: 'Capturing first frame',
      filePrefix: 'export-first-frame',
      completionLabel: 'First-frame export complete. ZIP download started.',
    });
  };

  const handleMaxFrameChange = (nextFrame: number) => {
    const clamped = Math.max(1, Math.round(nextFrame));
    setTimelineEndFrame(clamped);
    setCurrentFrame((prev) => {
      const next = Math.min(prev, clamped);
      currentFrameRef.current = next;
      return next;
    });
  };

  return (
    <div className="relative w-full h-screen bg-[#09090b] text-gray-300 overflow-hidden flex font-sans">
      {/* Left Icon Navigation Bar */}
      <div className="w-14 flex flex-col bg-[#0c0c10] border-r border-[#272730] h-full z-20 shrink-0">
        <div className="h-12 flex items-center justify-center border-b border-[#272730]">
          <div className="w-7 h-7 rounded-md bg-gradient-to-tr from-violet-600 to-indigo-500 flex items-center justify-center shadow-inner">
            <span className="text-[12px] font-bold text-white">M</span>
          </div>
        </div>
        <div className="flex-1 flex flex-col items-center py-4 gap-4">
          <button 
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${activeTab === 'characters' ? 'bg-violet-500/20 text-violet-400 border border-violet-500/30' : 'text-gray-500 hover:text-gray-300 hover:bg-[#16161d]'}`}
            onClick={() => handleTabChange('characters')}
            title="Characters"
          >
            <UserPlus className="w-5 h-5" />
          </button>
          <button 
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${activeTab === 'cameras' ? 'bg-violet-500/20 text-violet-400 border border-violet-500/30' : 'text-gray-500 hover:text-gray-300 hover:bg-[#16161d]'}`}
            onClick={() => handleTabChange('cameras')}
            title="Cameras"
          >
            <Camera className="w-5 h-5" />
          </button>
          <button 
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${activeTab === 'scene' ? 'bg-violet-500/20 text-violet-400 border border-violet-500/30' : 'text-gray-500 hover:text-gray-300 hover:bg-[#16161d]'}`}
            onClick={() => handleTabChange('scene')}
            title="Scene Settings"
          >
            <Box className="w-5 h-5" />
          </button>
          <button
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${activeTab === 'effects' ? 'bg-violet-500/20 text-violet-400 border border-violet-500/30' : 'text-gray-500 hover:text-gray-300 hover:bg-[#16161d]'}`}
            onClick={() => handleTabChange('effects')}
            title="Viewport Effects"
          >
            <Activity className="w-5 h-5" />
          </button>
          <button
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${activeTab === 'export' ? 'bg-violet-500/20 text-violet-400 border border-violet-500/30' : 'text-gray-500 hover:text-gray-300 hover:bg-[#16161d]'}`}
            onClick={() => handleTabChange('export')}
            title="Export Settings"
          >
            <Package className="w-5 h-5" />
          </button>
        </div>
        <div className="py-4 flex flex-col items-center">
          <button 
            className="w-10 h-10 rounded-xl flex items-center justify-center text-gray-500 hover:text-gray-300 hover:bg-[#16161d] transition-all"
            title="Global Settings"
          >
            <Settings2 className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Left Sidebar - Media/Character Panel */}
      <div className="w-[340px] flex flex-col bg-[#121217] border-r border-[#272730] h-full shadow-xl z-10 shrink-0">
        {/* Header */}
        <div className="h-12 px-4 flex items-center justify-between border-b border-[#272730] bg-[#0c0c10]">
          <h1 className="text-sm font-semibold text-white tracking-wide">
            {activeTab === 'characters' && 'Characters'}
            {activeTab === 'cameras' && 'Cameras'}
            {activeTab === 'scene' && 'Scene Settings'}
            {activeTab === 'effects' && 'Viewport Effects'}
            {activeTab === 'export' && 'Export Settings'}
          </h1>
        </div>

        {/* Characters Panel */}
        <div className={`flex-1 overflow-y-auto p-4 space-y-4 ${activeTab === 'characters' ? 'block' : 'hidden'}`} style={{ scrollbarGutter: 'stable' }}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5" /> Characters
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2.5 text-xs font-medium text-white bg-violet-600/20 hover:bg-violet-600/40 hover:text-white border border-violet-500/30 rounded flex items-center gap-1.5 transition-all"
              onClick={() => { addChar(false); }}
            >
              <UserPlus className="w-3.5 h-3.5" /> Add
            </Button>
          </div>

          <div className="space-y-3">
            {characters.filter(c => c.type !== 'stage').map((char) => {
              const status = getStatusText(char);
              const isSelected = selectedCharId === char.id;
              return (
              <div
                key={char.id}
                className={`rounded-xl border transition-all duration-200 overflow-hidden ${
                  isSelected 
                    ? 'border-violet-500/50 bg-[#1a1a24] shadow-[0_0_15px_rgba(139,92,246,0.05)]' 
                    : 'border-[#272730] bg-[#16161d] hover:border-gray-600/50 hover:bg-[#1a1a24]'
                }`}
              >
                {/* Character Header */}
                <div
                  className="flex items-center justify-between p-3 cursor-pointer group"
                  onClick={() => setSelectedCharId(char.id === selectedCharId ? null : char.id)}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                      char.modelFile 
                        ? 'bg-violet-500/20 text-violet-400 shadow-sm' 
                        : 'bg-gray-800 text-gray-500'
                    }`}>
                      {char.modelFile ? <Box className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
                    </div>
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className={`text-sm font-medium truncate ${isSelected ? 'text-white' : 'text-gray-200 group-hover:text-white'}`}>
                        {char.modelFile ? char.modelFile.name.replace(/\.(pmx|pmd)$/i, '') : `Character ${char.id + 1}`}
                      </span>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="flex items-center gap-1">
                          {status.icon}
                          <span className={`text-[10px] truncate ${status.color}`}>{status.text}</span>
                        </span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeCharacter(char.id);
                    }}
                    className="text-gray-500 hover:text-red-400 transition-colors p-1.5 rounded-md hover:bg-red-500/10 shrink-0 ml-2 opacity-0 group-hover:opacity-100"
                    title="Remove Character"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Expanded Character Details */}
                {isSelected && (
                  <div className="px-4 pb-4 pt-1 space-y-5 border-t border-[#272730] bg-[#121218]/50">
                    
                    {/* Model Section */}
                    <div className="space-y-2 pt-3">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-gray-300">
                        <Box className="w-3.5 h-3.5 text-violet-400" /> Model Setup
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs border-[#32323e] bg-[#1a1a24] hover:bg-violet-500/15 hover:border-violet-500/40 hover:text-white justify-start"
                          onClick={() => fileInputRefs.current[`model-${char.id}`]?.click()}
                        >
                          <FileArchive className="w-3.5 h-3.5 mr-2 text-gray-400" /> Load PMX
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs border-[#32323e] bg-[#1a1a24] hover:bg-violet-500/15 hover:border-violet-500/40 hover:text-white justify-start"
                          onClick={() => fileInputRefs.current[`model-zip-${char.id}`]?.click()}
                        >
                          <Archive className="w-3.5 h-3.5 mr-2 text-gray-400" /> From ZIP
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs border-[#32323e] bg-[#1a1a24] hover:bg-violet-500/15 hover:border-violet-500/40 hover:text-white justify-start col-span-2"
                          onClick={async () => {
                            try {
                              // @ts-expect-error showDirectoryPicker is not in standard types yet
                              const dirHandle = await window.showDirectoryPicker();
                              const files: File[] = [];
                              
                              async function getFilesFromDirectory(handle: FileSystemDirectoryHandle, path = '') {
                                // @ts-expect-error values() is not in standard types yet
                                for await (const entry of handle.values()) {
                                  if (entry.kind === 'file') {
                                    const file = await entry.getFile();
                                    // Preserve path info
                                    Object.defineProperty(file, 'webkitRelativePath', {
                                      value: path + entry.name,
                                      writable: false
                                    });
                                    files.push(file);
                                  } else if (entry.kind === 'directory') {
                                    await getFilesFromDirectory(entry, path + entry.name + '/');
                                  }
                                }
                              }
                              
                              await getFilesFromDirectory(dirHandle);
                              
                              if (files.length > 0) {
                                const syntheticEvent = {
                                  target: { files: files as unknown as FileList }
                                } as ChangeEvent<HTMLInputElement>;
                                void handleFolderUpload(syntheticEvent, char.id);
                              }
                            } catch (err) {
                              // User cancelled or API not supported
                              console.log('Directory picker cancelled or not supported');
                            }
                          }}
                        >
                          <FolderOpen className="w-3.5 h-3.5 mr-2 text-gray-400" /> Smart Load from Folder
                        </Button>
                      </div>
                    </div>

                    {/* Textures Section */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-gray-300">
                        <ImageIcon className="w-3.5 h-3.5 text-amber-400" /> Textures
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs border-[#32323e] bg-[#1a1a24] hover:bg-amber-500/15 hover:border-amber-500/40 hover:text-white justify-start"
                          onClick={() => fileInputRefs.current[`texture-${char.id}`]?.click()}
                        >
                          <ImageIcon className="w-3.5 h-3.5 mr-2 text-gray-400" /> Add Files
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs border-[#32323e] bg-[#1a1a24] hover:bg-amber-500/15 hover:border-amber-500/40 hover:text-white justify-start"
                          onClick={() => fileInputRefs.current[`texture-dir-${char.id}`]?.click()}
                        >
                          <FolderOpen className="w-3.5 h-3.5 mr-2 text-gray-400" /> Add Folder
                        </Button>
                      </div>
                    </div>

                    {/* Motion Section */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-gray-300">
                        <Film className="w-3.5 h-3.5 text-emerald-400" /> Motion (VMD / VRMA / FBX / BVH)
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 w-full text-xs border-[#32323e] bg-[#1a1a24] hover:bg-emerald-500/15 hover:border-emerald-500/40 hover:text-white justify-start"
                        onClick={() => fileInputRefs.current[`vmd-${char.id}`]?.click()}
                      >
                        <PlaySquare className="w-3.5 h-3.5 mr-2 text-gray-400" /> Load Animation Data
                      </Button>
                    </div>

                    {/* Hidden Inputs */}
                    <input
                      ref={(el) => { fileInputRefs.current[`model-${char.id}`] = el; }}
                      type="file"
                      className="hidden"
                      onChange={(e) => void handleModelUpload(e, char.id)}
                    />
                    <input
                      ref={(el) => { fileInputRefs.current[`model-zip-${char.id}`] = el; }}
                      type="file"
                      accept=".zip"
                      className="hidden"
                      onChange={(e) => void handleZipUpload(e, char.id)}
                    />
                    <input
                      ref={(el) => { fileInputRefs.current[`texture-${char.id}`] = el; }}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => void handleTextureUpload(e, char.id)}
                    />
                    <input
                      ref={(el) => {
                        if (el) (el as HTMLInputElement & { webkitdirectory?: boolean }).webkitdirectory = true;
                        fileInputRefs.current[`texture-dir-${char.id}`] = el;
                      }}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => void handleTextureUpload(e, char.id)}
                    />
                    <input
                      ref={(el) => { fileInputRefs.current[`vmd-${char.id}`] = el; }}
                      type="file"
                      accept=".vmd,.vrma,.fbx,.bvh"
                      multiple
                      className="hidden"
                      onChange={(e) => handleVmdUpload(e, char.id)}
                    />

                    {/* Physics & Transform Properties */}
                    {(char.loaded || char.mesh) && (
                      <div className="pt-4 mt-4 border-t border-[#272730] space-y-4">
                        {/* Physics Toggle */}
                        {char.mmdHelper && (
                          <div className="flex items-center justify-between bg-[#16161d] p-2.5 rounded-lg border border-[#272730]">
                            <div className="flex items-center gap-2 text-xs text-gray-300 font-medium">
                              <Activity className="w-3.5 h-3.5 text-blue-400" />
                              Physics Engine
                            </div>
                            <button
                              onClick={() => handleTogglePhysics(char.id, char)}
                              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 focus:ring-offset-[#121217] ${
                                char.physicsEnabled ? 'bg-blue-500' : 'bg-gray-600'
                              }`}
                            >
                              <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                                  char.physicsEnabled ? 'translate-x-4' : 'translate-x-0'
                                }`}
                              />
                            </button>
                          </div>
                        )}

                        {/* Transform Controls */}
                        <div className="space-y-3">
                          <div className="flex items-center gap-1.5 text-xs font-medium text-gray-300">
                            <Move className="w-3.5 h-3.5 text-gray-400" /> Transform
                          </div>
                          <div className="space-y-2.5 bg-[#16161d] p-3 rounded-lg border border-[#272730]">
                            {[
                              { key: 'x', label: 'Pos X', min: -100, max: 100, step: 0.5 },
                              { key: 'y', label: 'Pos Y', min: -50, max: 50, step: 0.5 },
                              { key: 'z', label: 'Pos Z', min: -100, max: 100, step: 0.5 },
                              { key: 'rx', label: 'Rot X', min: -180, max: 180, step: 1, suffix: '°' },
                              { key: 'ry', label: 'Rot Y', min: -180, max: 180, step: 1, suffix: '°' },
                              { key: 'rz', label: 'Rot Z', min: -180, max: 180, step: 1, suffix: '°' },
                              { key: 's', label: 'Scale', min: 0.1, max: 5, step: 0.05 },
                            ].map((axis) => (
                              <div key={axis.key} className="grid grid-cols-[40px_1fr_40px] gap-3 items-center group/slider">
                                <span className="text-[10px] font-medium text-gray-400">{axis.label}</span>
                                <input
                                  type="range"
                                  min={axis.min}
                                  max={axis.max}
                                  step={axis.step}
                                  value={char.tx[axis.key as keyof typeof char.tx]}
                                  onChange={(e) => updateCharacterTransform(char.id, axis.key as keyof typeof char.tx, Number(e.target.value))}
                                  className="w-full h-1.5 bg-[#272730] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-violet-500 [&::-webkit-slider-thumb]:hover:bg-violet-400 [&::-webkit-slider-thumb]:transition-colors"
                                />
                                <span className="text-[10px] text-gray-300 text-right font-mono bg-[#121218] px-1 py-0.5 rounded border border-[#272730]">
                                  {axis.key === 's' ? char.tx.s.toFixed(2) : axis.suffix ? `${Math.round(char.tx[axis.key as keyof typeof char.tx] as number)}${axis.suffix}` : (char.tx[axis.key as keyof typeof char.tx] as number).toFixed(1)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              );
            })}

            {characters.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-center border-2 border-dashed border-[#272730] rounded-xl bg-[#16161d]/50">
                <div className="w-12 h-12 rounded-full bg-[#1a1a24] flex items-center justify-center mb-3">
                  <UserPlus className="w-6 h-6 text-gray-500" />
                </div>
                <h3 className="text-sm font-medium text-gray-300 mb-1">No characters</h3>
                <p className="text-xs text-gray-500 max-w-[200px]">Add a character to begin importing models and motions.</p>
                <Button
                  size="sm"
                  className="mt-4 h-8 bg-violet-600/20 hover:bg-violet-600/40 text-white border border-violet-500/30"
                  onClick={() => { addChar(false); }}
                >
                  <UserPlus className="w-4 h-4 mr-2" /> Add Character
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Cameras Panel */}
        <div className={`flex-1 overflow-y-auto p-4 space-y-4 ${activeTab === 'cameras' ? 'block' : 'hidden'}`} style={{ scrollbarGutter: 'stable' }}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
              <Camera className="w-3.5 h-3.5" /> Cameras
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2.5 text-xs font-medium text-white bg-violet-600/20 hover:bg-violet-600/40 hover:text-white border border-violet-500/30 rounded flex items-center gap-1.5 transition-all"
              onClick={addCamera}
            >
              <UserPlus className="w-3.5 h-3.5" /> Add
            </Button>
          </div>

          <div className="rounded-xl border border-[#272730] bg-[#16161d] p-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold text-gray-300">Camera translation (world)</div>
                <p className="text-[10px] text-gray-500 leading-snug mt-0.5">
                  Orbit: moves camera and target together when you change a slider (no per-frame add). VMD active camera: offset is applied around each render and removed afterward so motion stays correct. While export pauses the main timeline, the view still redraws and PNG captures include this offset.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 shrink-0 px-2 text-[10px] text-gray-400 hover:text-white border border-[#2a2a34] hover:bg-[#1f1f28]"
                onClick={() => setCameraTranslation({ x: 0, y: 0, z: 0 })}
              >
                Reset
              </Button>
            </div>
            {(['x', 'y', 'z'] as const).map((axis) => (
              <div key={axis} className="grid grid-cols-[14px_1fr_52px] items-center gap-2">
                <span className="text-[10px] font-mono text-gray-500 uppercase">{axis}</span>
                <input
                  type="range"
                  min={-30}
                  max={30}
                  step={0.05}
                  value={cameraTranslation[axis]}
                  onChange={(e) =>
                    setCameraTranslation((prev) => ({
                      ...prev,
                      [axis]: parseFloat(e.target.value),
                    }))
                  }
                  className="w-full accent-violet-500"
                />
                <span className="text-[10px] font-mono text-gray-400 text-right tabular-nums">
                  {cameraTranslation[axis].toFixed(2)}
                </span>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            {cameras.map((cam) => {
              const isSelected = selectedCameraId === cam.id;
              const isActive = activeCameraId === cam.id;
              
              let statusText = 'No motion loaded';
              let statusColor = 'text-gray-500';
              if (cam.loading) {
                statusText = 'Loading motion...';
                statusColor = 'text-amber-400';
              } else if (cam.error) {
                statusText = cam.error;
                statusColor = 'text-rose-400';
              } else if (cam.loaded && cam.vmdFile) {
                statusText = `Motion ready · ${cam.durationFrames}f`;
                statusColor = 'text-emerald-400';
              } else if (cam.vmdFile) {
                statusText = 'Motion file selected';
                statusColor = 'text-gray-400';
              }

              return (
                <div
                  key={cam.id}
                  className={`rounded-xl border transition-all duration-200 overflow-hidden ${
                    isSelected 
                      ? 'border-violet-500/50 bg-[#1a1a24] shadow-[0_0_15px_rgba(139,92,246,0.05)]' 
                      : isActive
                        ? 'border-emerald-500/30 bg-[#16161d]'
                        : 'border-[#272730] bg-[#16161d] hover:border-gray-600/50 hover:bg-[#1a1a24]'
                  }`}
                >
                  {/* Camera Header */}
                  <div
                    className="flex items-center justify-between p-3 cursor-pointer group"
                    onClick={() => setSelectedCameraId(cam.id === selectedCameraId ? null : cam.id)}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                        isActive ? 'bg-emerald-500/20 text-emerald-400 shadow-sm' : 'bg-gray-800 text-gray-500'
                      }`}>
                        <Camera className="w-4 h-4" />
                      </div>
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className={`text-sm font-medium truncate ${isSelected || isActive ? 'text-white' : 'text-gray-200 group-hover:text-white'}`}>
                          {cam.name}
                        </span>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className={`text-[10px] truncate ${statusColor}`}>{statusText}</span>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeCamera(cam.id);
                      }}
                      className="text-gray-500 hover:text-red-400 transition-colors p-1.5 rounded-md hover:bg-red-500/10 shrink-0 ml-2 opacity-0 group-hover:opacity-100"
                      title="Remove Camera"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Expanded Camera Details */}
                  {isSelected && (
                    <div className="px-4 pb-4 pt-1 space-y-4 border-t border-[#272730] bg-[#121218]/50">
                      <div className="pt-3 flex items-center justify-between">
                        <span className="text-xs text-gray-300 font-medium">Set Active</span>
                        <button
                          onClick={() => switchActiveCamera(isActive ? null : cam.id)}
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 focus:ring-offset-[#121217] ${
                            isActive ? 'bg-emerald-500' : 'bg-gray-600'
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                              isActive ? 'translate-x-4' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center gap-1.5 text-xs font-medium text-gray-300">
                          <Film className="w-3.5 h-3.5 text-emerald-400" /> Camera Motion (VMD)
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 w-full text-xs border-[#32323e] bg-[#1a1a24] hover:bg-emerald-500/15 hover:border-emerald-500/40 hover:text-white justify-start"
                          onClick={() => fileInputRefs.current[`camera-vmd-${cam.id}`]?.click()}
                        >
                          <PlaySquare className="w-3.5 h-3.5 mr-2 text-gray-400" /> Load Camera Data
                        </Button>
                      </div>

                      {/* Hidden Input */}
                      <input
                        ref={(el) => { fileInputRefs.current[`camera-vmd-${cam.id}`] = el; }}
                        type="file"
                        accept=".vmd"
                        multiple
                        className="hidden"
                        onChange={(e) => handleCameraVmdUpload(e, cam.id)}
                      />
                    </div>
                  )}
                </div>
              );
            })}

            {cameras.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-center border-2 border-dashed border-[#272730] rounded-xl bg-[#16161d]/50">
                <div className="w-12 h-12 rounded-full bg-[#1a1a24] flex items-center justify-center mb-3">
                  <Camera className="w-6 h-6 text-gray-500" />
                </div>
                <h3 className="text-sm font-medium text-gray-300 mb-1">No cameras</h3>
                <p className="text-xs text-gray-500 max-w-[200px]">Add a camera to import VMD camera motions.</p>
                <Button
                  size="sm"
                  className="mt-4 h-8 bg-violet-600/20 hover:bg-violet-600/40 text-white border border-violet-500/30"
                  onClick={addCamera}
                >
                  <UserPlus className="w-4 h-4 mr-2" /> Add Camera
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Scene Panel */}
        <div className={`flex-1 overflow-y-auto p-4 space-y-4 ${activeTab === 'scene' ? 'block' : 'hidden'}`} style={{ scrollbarGutter: 'stable' }}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
              <Box className="w-3.5 h-3.5" /> Stages
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2.5 text-xs font-medium text-white bg-violet-600/20 hover:bg-violet-600/40 hover:text-white border border-violet-500/30 rounded flex items-center gap-1.5 transition-all"
              onClick={() => { addChar(true); }}
            >
              <UserPlus className="w-3.5 h-3.5" /> Add
            </Button>
          </div>

          <div className="space-y-3">
            {/* Default Floor Stage */}
            <div className="rounded-xl border border-[#272730] bg-[#16161d] hover:border-gray-600/50 hover:bg-[#1a1a24] transition-all duration-200 overflow-hidden">
              <div className="p-3">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-gray-800 text-gray-500">
                    <Box className="w-4 h-4" />
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-sm font-medium truncate text-gray-200">Default Floor</span>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="flex items-center gap-1">
                        <span className={`w-2 h-2 rounded-full ${defaultStageVisible ? 'bg-emerald-500' : 'bg-gray-500'}`}></span>
                        <span className="text-[10px] truncate text-gray-400">{defaultStageVisible ? 'Visible' : 'Hidden'}</span>
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => setDefaultStageVisible((prev) => !prev)}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 focus:ring-offset-[#121217] ${
                      defaultStageVisible ? 'bg-violet-500' : 'bg-gray-600'
                    }`}
                    title={defaultStageVisible ? 'Hide Default Floor' : 'Show Default Floor'}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                        defaultStageVisible ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                <div className="grid grid-cols-[1fr_auto] items-center gap-3">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={defaultStageVisible ? 1 : 0}
                    disabled={!defaultStageVisible}
                    onChange={(e) => setDefaultStageVisible(Number(e.target.value) > 0.5)}
                    className="w-full h-1.5 bg-[#272730] rounded-full appearance-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-violet-500 [&::-webkit-slider-thumb]:hover:bg-violet-400"
                  />
                  <span className="text-[10px] text-gray-300 text-right font-mono bg-[#121218] px-2 py-0.5 rounded border border-[#272730] min-w-[46px]">
                    {defaultStageVisible ? '100%' : '0%'}
                  </span>
                </div>
              </div>
            </div>

            {characters.filter(c => c.type === 'stage').map((char) => {
              const status = getStatusText(char);
              const isSelected = selectedCharId === char.id;
              return (
              <div
                key={char.id}
                className={`rounded-xl border transition-all duration-200 overflow-hidden ${
                  isSelected 
                    ? 'border-violet-500/50 bg-[#1a1a24] shadow-[0_0_15px_rgba(139,92,246,0.05)]' 
                    : 'border-[#272730] bg-[#16161d] hover:border-gray-600/50 hover:bg-[#1a1a24]'
                }`}
              >
                {/* Character Header */}
                <div
                  className="flex items-center justify-between p-3 cursor-pointer group"
                  onClick={() => setSelectedCharId(char.id === selectedCharId ? null : char.id)}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                      char.modelFile 
                        ? 'bg-violet-500/20 text-violet-400 shadow-sm' 
                        : 'bg-gray-800 text-gray-500'
                    }`}>
                      {char.modelFile ? <Box className="w-4 h-4" /> : <Box className="w-4 h-4" />}
                    </div>
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className={`text-sm font-medium truncate ${isSelected ? 'text-white' : 'text-gray-200 group-hover:text-white'}`}>
                        {char.modelFile ? char.modelFile.name.replace(/\.(pmx|pmd)$/i, '') : `Stage ${char.id + 1}`}
                      </span>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="flex items-center gap-1">
                          {status.icon}
                          <span className={`text-[10px] truncate ${status.color}`}>{status.text}</span>
                        </span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeCharacter(char.id);
                    }}
                    className="text-gray-500 hover:text-red-400 transition-colors p-1.5 rounded-md hover:bg-red-500/10 shrink-0 ml-2 opacity-0 group-hover:opacity-100"
                    title="Remove Stage"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Expanded Character Details */}
                {isSelected && (
                  <div className="px-4 pb-4 pt-1 space-y-5 border-t border-[#272730] bg-[#121218]/50">
                    
                    {/* Model Section */}
                    <div className="space-y-2 pt-3">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-gray-300">
                        <Box className="w-3.5 h-3.5 text-violet-400" /> Model Setup
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs border-[#32323e] bg-[#1a1a24] hover:bg-violet-500/15 hover:border-violet-500/40 hover:text-white justify-start"
                          onClick={() => fileInputRefs.current[`model-${char.id}`]?.click()}
                        >
                          <FileArchive className="w-3.5 h-3.5 mr-2 text-gray-400" /> Load PMX
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs border-[#32323e] bg-[#1a1a24] hover:bg-violet-500/15 hover:border-violet-500/40 hover:text-white justify-start"
                          onClick={() => fileInputRefs.current[`model-zip-${char.id}`]?.click()}
                        >
                          <Archive className="w-3.5 h-3.5 mr-2 text-gray-400" /> From ZIP
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs border-[#32323e] bg-[#1a1a24] hover:bg-violet-500/15 hover:border-violet-500/40 hover:text-white justify-start col-span-2"
                          onClick={async () => {
                            try {
                              // @ts-expect-error showDirectoryPicker is not in standard types yet
                              const dirHandle = await window.showDirectoryPicker();
                              const files: File[] = [];
                              
                              async function getFilesFromDirectory(handle: FileSystemDirectoryHandle, path = '') {
                                // @ts-expect-error values() is not in standard types yet
                                for await (const entry of handle.values()) {
                                  if (entry.kind === 'file') {
                                    const file = await entry.getFile();
                                    // Preserve path info
                                    Object.defineProperty(file, 'webkitRelativePath', {
                                      value: path + entry.name,
                                      writable: false
                                    });
                                    files.push(file);
                                  } else if (entry.kind === 'directory') {
                                    await getFilesFromDirectory(entry, path + entry.name + '/');
                                  }
                                }
                              }
                              
                              await getFilesFromDirectory(dirHandle);
                              
                              if (files.length > 0) {
                                const syntheticEvent = {
                                  target: { files: files as unknown as FileList }
                                } as ChangeEvent<HTMLInputElement>;
                                void handleFolderUpload(syntheticEvent, char.id);
                              }
                            } catch (err) {
                              // User cancelled or API not supported
                              console.log('Directory picker cancelled or not supported');
                            }
                          }}
                        >
                          <FolderOpen className="w-3.5 h-3.5 mr-2 text-gray-400" /> Smart Load from Folder
                        </Button>
                      </div>
                    </div>

                    {/* Textures Section */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-gray-300">
                        <ImageIcon className="w-3.5 h-3.5 text-amber-400" /> Textures
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs border-[#32323e] bg-[#1a1a24] hover:bg-amber-500/15 hover:border-amber-500/40 hover:text-white justify-start"
                          onClick={() => fileInputRefs.current[`texture-${char.id}`]?.click()}
                        >
                          <ImageIcon className="w-3.5 h-3.5 mr-2 text-gray-400" /> Add Files
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs border-[#32323e] bg-[#1a1a24] hover:bg-amber-500/15 hover:border-amber-500/40 hover:text-white justify-start"
                          onClick={() => fileInputRefs.current[`texture-dir-${char.id}`]?.click()}
                        >
                          <FolderOpen className="w-3.5 h-3.5 mr-2 text-gray-400" /> Add Folder
                        </Button>
                      </div>
                    </div>

                    {/* Motion Section */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-gray-300">
                        <Film className="w-3.5 h-3.5 text-emerald-400" /> Motion (VMD)
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 w-full text-xs border-[#32323e] bg-[#1a1a24] hover:bg-emerald-500/15 hover:border-emerald-500/40 hover:text-white justify-start"
                        onClick={() => fileInputRefs.current[`vmd-${char.id}`]?.click()}
                      >
                        <PlaySquare className="w-3.5 h-3.5 mr-2 text-gray-400" /> Load Animation Data
                      </Button>
                    </div>

                    {/* Hidden Inputs */}
                    <input
                      ref={(el) => { fileInputRefs.current[`model-${char.id}`] = el; }}
                      type="file"
                      className="hidden"
                      onChange={(e) => void handleModelUpload(e, char.id)}
                    />
                    <input
                      ref={(el) => { fileInputRefs.current[`model-zip-${char.id}`] = el; }}
                      type="file"
                      accept=".zip"
                      className="hidden"
                      onChange={(e) => void handleZipUpload(e, char.id)}
                    />
                    <input
                      ref={(el) => { fileInputRefs.current[`texture-${char.id}`] = el; }}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => void handleTextureUpload(e, char.id)}
                    />
                    <input
                      ref={(el) => {
                        if (el) (el as HTMLInputElement & { webkitdirectory?: boolean }).webkitdirectory = true;
                        fileInputRefs.current[`texture-dir-${char.id}`] = el;
                      }}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => void handleTextureUpload(e, char.id)}
                    />
                    <input
                      ref={(el) => { fileInputRefs.current[`vmd-${char.id}`] = el; }}
                      type="file"
                      accept=".vmd"
                      multiple
                      className="hidden"
                      onChange={(e) => handleVmdUpload(e, char.id)}
                    />

                    {/* Physics & Transform Properties */}
                    {(char.loaded || char.mesh) && (
                      <div className="pt-4 mt-4 border-t border-[#272730] space-y-4">
                        {/* Physics Toggle */}
                        {char.mmdHelper && (
                          <div className="flex items-center justify-between bg-[#16161d] p-2.5 rounded-lg border border-[#272730]">
                            <div className="flex items-center gap-2 text-xs text-gray-300 font-medium">
                              <Activity className="w-3.5 h-3.5 text-blue-400" />
                              Physics Engine
                            </div>
                            <button
                              onClick={() => handleTogglePhysics(char.id, char)}
                              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 focus:ring-offset-[#121217] ${
                                char.physicsEnabled ? 'bg-blue-500' : 'bg-gray-600'
                              }`}
                            >
                              <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                                  char.physicsEnabled ? 'translate-x-4' : 'translate-x-0'
                                }`}
                              />
                            </button>
                          </div>
                        )}

                        {/* Transform Controls */}
                        <div className="space-y-3">
                          <div className="flex items-center gap-1.5 text-xs font-medium text-gray-300">
                            <Move className="w-3.5 h-3.5 text-gray-400" /> Transform
                          </div>
                          <div className="space-y-2.5 bg-[#16161d] p-3 rounded-lg border border-[#272730]">
                            {[
                              { key: 'x', label: 'Pos X', min: -100, max: 100, step: 0.5 },
                              { key: 'y', label: 'Pos Y', min: -50, max: 50, step: 0.5 },
                              { key: 'z', label: 'Pos Z', min: -100, max: 100, step: 0.5 },
                              { key: 'rx', label: 'Rot X', min: -180, max: 180, step: 1, suffix: '°' },
                              { key: 'ry', label: 'Rot Y', min: -180, max: 180, step: 1, suffix: '°' },
                              { key: 'rz', label: 'Rot Z', min: -180, max: 180, step: 1, suffix: '°' },
                              { key: 's', label: 'Scale', min: 0.1, max: 5, step: 0.05 },
                            ].map((axis) => (
                              <div key={axis.key} className="grid grid-cols-[40px_1fr_40px] gap-3 items-center group/slider">
                                <span className="text-[10px] font-medium text-gray-400">{axis.label}</span>
                                <input
                                  type="range"
                                  min={axis.min}
                                  max={axis.max}
                                  step={axis.step}
                                  value={char.tx[axis.key as keyof typeof char.tx]}
                                  onChange={(e) => updateCharacterTransform(char.id, axis.key as keyof typeof char.tx, Number(e.target.value))}
                                  className="w-full h-1.5 bg-[#272730] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-violet-500 [&::-webkit-slider-thumb]:hover:bg-violet-400 [&::-webkit-slider-thumb]:transition-colors"
                                />
                                <span className="text-[10px] text-gray-300 text-right font-mono bg-[#121218] px-1 py-0.5 rounded border border-[#272730]">
                                  {axis.key === 's' ? char.tx.s.toFixed(2) : axis.suffix ? `${Math.round(char.tx[axis.key as keyof typeof char.tx] as number)}${axis.suffix}` : (char.tx[axis.key as keyof typeof char.tx] as number).toFixed(1)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              );
            })}

            {characters.filter(c => c.type === 'stage').length === 0 && (
              <div className="flex flex-col items-center justify-center py-8 px-4 text-center border border-dashed border-[#272730] rounded-xl bg-[#16161d]/30">
                <p className="text-xs text-gray-500 mb-3">No custom stage models loaded</p>
                <Button
                  size="sm"
                  className="h-7 bg-violet-600/20 hover:bg-violet-600/40 text-white border border-violet-500/30 text-xs"
                  onClick={() => { addChar(true); }}
                >
                  <UserPlus className="w-3.5 h-3.5 mr-1.5" /> Add Stage Model
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Effects Panel */}
        <div className={`flex-1 overflow-y-auto p-4 space-y-4 ${activeTab === 'effects' ? 'block' : 'hidden'}`} style={{ scrollbarGutter: 'stable' }}>
          <div className="rounded-lg border border-violet-500/20 bg-violet-950/25 px-3 py-2.5 space-y-1">
            <div className="text-[11px] font-semibold text-violet-300">Shading pipeline</div>
            <p className="text-[10px] text-gray-400 leading-relaxed">
              Render → <span className="text-gray-300">GTAO</span> (ground-truth ambient occlusion + denoise) → color grade → bloom &amp; depth → optional cel / edge-rim / grain. Replaces older SSAO and sigmoid &quot;toon&quot; passes that caused contour banding on curved meshes.
            </p>
          </div>

          {/* Preset Selector */}
          <div className="rounded-xl border border-[#272730] bg-[#16161d] p-4 space-y-3">
            <div>
              <div className="text-sm font-semibold text-gray-100">Effects Preset</div>
              <div className="text-[11px] text-gray-500 mt-0.5">Apply a preset to set multiple effects at once.</div>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {(Object.entries(EFFECTS_PRESETS) as [EffectsPresetKey, typeof EFFECTS_PRESETS[EffectsPresetKey]][]).map(([key, preset]) => (
                <button
                  key={key}
                  onClick={() => applyEffectsPreset(key)}
                  className="px-2 py-1.5 rounded-md border border-[#2a2a34] bg-[#121218] hover:bg-violet-500/20 hover:border-violet-500/40 text-[10px] font-medium text-gray-300 hover:text-white transition-colors text-center truncate"
                  title={preset.description}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>

          {/* Sub-preset Selectors */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-[#272730] bg-[#16161d] p-3 space-y-2">
              <div className="text-[11px] font-semibold text-gray-300">Color Grading</div>
              <select
                value={viewportEffects.colorGradingPreset}
                onChange={(event) => updateViewportEffect('colorGradingPreset', event.target.value as ViewportEffects['colorGradingPreset'])}
                className="w-full rounded-md border border-[#2a2a34] bg-[#121218] px-2 py-1.5 text-[11px] text-gray-200 focus:outline-none focus:ring-1 focus:ring-violet-500"
              >
                <option value="neutral">Neutral</option>
                <option value="cinematic">Cinematic</option>
                <option value="anime">Anime</option>
                <option value="cool">Cool</option>
                <option value="warm">Warm</option>
              </select>
            </div>
            <div className="rounded-xl border border-[#272730] bg-[#16161d] p-3 space-y-2">
              <div className="text-[11px] font-semibold text-gray-300">Glow Style</div>
              <select
                value={viewportEffects.glowPreset}
                onChange={(event) => updateViewportEffect('glowPreset', event.target.value as ViewportEffects['glowPreset'])}
                className="w-full rounded-md border border-[#2a2a34] bg-[#121218] px-2 py-1.5 text-[11px] text-gray-200 focus:outline-none focus:ring-1 focus:ring-violet-500"
              >
                <option value="studio">Studio</option>
                <option value="soft">Soft</option>
                <option value="neon">Neon</option>
                <option value="dream">Dream</option>
              </select>
            </div>
          </div>

          {[
            {
              category: 'Exposure & color',
              blurb: 'Tone mapping and grading run after ambient occlusion.',
              effects: [
                { key: 'toneMapping', title: 'ACES tone mapping', desc: 'Scene exposure and highlight balance', enabledKey: 'toneMappingEnabled' as const, strengthKey: 'toneMappingStrength' as const },
                { key: 'colorGrading', title: 'Color grading', desc: 'Hue / saturation (preset above)', enabledKey: 'colorGradingEnabled' as const, strengthKey: 'colorGradingStrength' as const },
                { key: 'brightnessContrast', title: 'Brightness / contrast', desc: 'Global lift and punch', enabledKey: 'brightnessContrastEnabled' as const, strengthKey: 'brightnessContrastStrength' as const },
              ],
            },
            {
              category: 'Scene lighting',
              blurb: 'Real directional rim in the 3D scene (warm key). Distinct from post-process soft rim glow.',
              effects: [
                { key: 'rimLighting', title: 'Rim light (3D)', desc: 'Back/rim directional — use camera follow for orbit-friendly edges', enabledKey: 'rimLightingEnabled' as const, strengthKey: 'rimLightingStrength' as const },
              ],
            },
            {
              category: 'Materials',
              blurb: 'Character material swap (PBR/classic) + IBL. Rim glow and dark edge lines share one pre-bloom pass (resolution-safe). IBL portrait adjusts MeshPhysical sheen/clearcoat only — avoids transmission with the composer.',
              effects: [
                { key: 'meshPhysical', title: 'Character material swap', desc: 'When enabled, MMD toon / Standard → selected three.js material model + scene IBL (for physical).', enabledKey: 'meshPhysicalEnabled' as const, strengthKey: 'meshPhysicalStrength' as const },
                { key: 'meshRimGlow', title: 'Soft rim glow', desc: 'Mesh-depth silhouette halo before bloom (not texture edges; pair with dark lines)', enabledKey: 'meshRimGlowEnabled' as const, strengthKey: 'meshRimGlowStrength' as const },
                { key: 'iblStudioPortrait', title: 'IBL studio portrait', desc: 'Softer key/fill/rim, softer shadows, stronger probe; extra sheen/clearcoat on MeshPhysical (no transmission — stable with post)', enabledKey: 'iblStudioPortraitEnabled' as const, strengthKey: 'iblStudioPortraitStrength' as const },
              ],
            },
            {
              category: 'Depth & atmosphere',
              blurb: 'GTAO darkens crevices; bloom and DOF are screen-space.',
              effects: [
                { key: 'ambientOcclusion', title: 'Ambient occlusion (GTAO)', desc: 'Ground-truth AO + denoise — contact shadow', enabledKey: 'ambientOcclusionEnabled' as const, strengthKey: 'ambientOcclusionStrength' as const },
                { key: 'bloom', title: 'Bloom', desc: 'Unreal-style highlight glow', enabledKey: 'bloomEnabled' as const, strengthKey: 'bloomStrength' as const },
                { key: 'depthOfField', title: 'Depth of field', desc: 'Bokeh blur (depth-based)', enabledKey: 'depthOfFieldEnabled' as const, strengthKey: 'depthOfFieldStrength' as const },
                { key: 'vignette', title: 'Vignette', desc: 'Edge darkening', enabledKey: 'vignetteEnabled' as const, strengthKey: 'vignetteStrength' as const },
              ],
            },
            {
              category: 'Stylization',
              blurb: 'Cel uses dithered bands; screen outline uses depth edges; inverted hull is a 3D mesh extrusion outline.',
              effects: [
                { key: 'toonShading', title: 'Cel / toon', desc: 'Dithered tone bands (hue-preserving)', enabledKey: 'toonShadingEnabled' as const, strengthKey: 'toonShadingStrength' as const },
                { key: 'outline', title: 'Edge / rim (dark lines)', desc: 'Depth-based Sobel (mesh silhouettes, not texture edges); combine with soft rim glow', enabledKey: 'outlineEnabled' as const, strengthKey: 'outlineStrength' as const },
                { key: 'invertedHull', title: 'Inverted hull outline (3D)', desc: 'Back-face shell extruded along normals — unlit black, follows morphs/skinning', enabledKey: 'invertedHullOutlineEnabled' as const, strengthKey: 'invertedHullOutlineStrength' as const },
                { key: 'posterize', title: 'Posterize', desc: 'Dithered level reduction', enabledKey: 'posterizeEnabled' as const, strengthKey: 'posterizeStrength' as const },
                { key: 'pixelate', title: 'Pixelate', desc: 'Retro block size', enabledKey: 'pixelateEnabled' as const, strengthKey: 'pixelateStrength' as const },
              ],
            },
            {
              category: 'Motion & finishing',
              blurb: 'All composited in linear HDR; display tone map runs in a fixed output pass (matches bloom), so these do not inherit the same global darkening.',
              effects: [
                { key: 'afterimage', title: 'Afterimage', desc: 'Motion trails', enabledKey: 'afterimageEnabled' as const, strengthKey: 'afterimageStrength' as const },
                { key: 'glitch', title: 'Glitch', desc: 'RGB block distortion', enabledKey: 'glitchEnabled' as const, strengthKey: 'glitchStrength' as const },
                { key: 'chromaticAberration', title: 'Chromatic aberration', desc: 'Radial RGB split', enabledKey: 'chromaticAberrationEnabled' as const, strengthKey: 'chromaticAberrationStrength' as const },
                { key: 'filmGrain', title: 'Film grain', desc: 'Screen-space noise', enabledKey: 'filmGrainEnabled' as const, strengthKey: 'filmGrainStrength' as const },
                { key: 'sharpen', title: 'Sharpen', desc: 'Laplace high-pass', enabledKey: 'sharpenEnabled' as const, strengthKey: 'sharpenStrength' as const },
                { key: 'sepia', title: 'Sepia', desc: 'Warm monochrome', enabledKey: 'sepiaEnabled' as const, strengthKey: 'sepiaStrength' as const },
              ],
            },
          ].map((group) => (
            <div key={group.category} className="space-y-2">
              <div className="px-1 space-y-0.5">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{group.category}</h3>
                <p className="text-[10px] text-gray-600 leading-snug">{group.blurb}</p>
              </div>
            {group.category === 'Scene lighting' && (
              <div className="rounded-lg border border-[#272730] bg-[#16161d] px-3 py-2 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-gray-100 truncate">Align rim to camera</div>
                    <div className="text-[10px] text-gray-500 truncate">Places the rim behind the orbit target relative to the view. Off uses a fixed stage direction.</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => updateViewportEffect('rimLightingCameraAligned', !viewportEffects.rimLightingCameraAligned)}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                      viewportEffects.rimLightingCameraAligned ? 'bg-violet-500' : 'bg-gray-600'
                    }`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${viewportEffects.rimLightingCameraAligned ? 'translate-x-4' : 'translate-x-0'}`} />
                  </button>
                </div>
              </div>
            )}
            {group.category === 'Materials' && (
              <div className="rounded-lg border border-[#272730] bg-[#16161d] px-3 py-2 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-gray-100 truncate">Character material model</div>
                    <div className="text-[10px] text-gray-500 truncate">Used when `Character material swap` is enabled.</div>
                  </div>
                </div>
                <select
                  value={viewportEffects.characterMaterialMode}
                  onChange={(event) => updateViewportEffect('characterMaterialMode', event.target.value as ViewportEffects['characterMaterialMode'])}
                  className="w-full rounded-md border border-[#2a2a34] bg-[#121218] px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:ring-2 focus:ring-violet-500"
                >
                  {CHARACTER_MATERIAL_MODE_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <div className="flex items-center justify-between gap-2 pt-2">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-gray-100 truncate">Apply to stage</div>
                    <div className="text-[10px] text-gray-500 truncate">Uses the same material model/strength.</div>
                  </div>
                  <button
                    onClick={() => updateViewportEffect('stageMaterialEnabled', !viewportEffects.stageMaterialEnabled)}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                      viewportEffects.stageMaterialEnabled ? 'bg-violet-500' : 'bg-gray-600'
                    }`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${viewportEffects.stageMaterialEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
                  </button>
                </div>
              </div>
            )}
              {group.effects.map((effect) => {
                const enabled = Boolean(viewportEffects[effect.enabledKey]);
                const rawStrength = viewportEffects[effect.strengthKey];
                const strength =
                  typeof rawStrength === 'number' && !Number.isNaN(rawStrength)
                    ? rawStrength
                    : 0;
                return (
                  <div key={effect.key} className="rounded-lg border border-[#272730] bg-[#16161d] px-3 py-2.5 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-gray-100 truncate">{effect.title}</div>
                        <div className="text-[10px] text-gray-500 truncate">{effect.desc}</div>
                      </div>
                      <button
                        onClick={() => updateViewportEffect(effect.enabledKey, !enabled)}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                          enabled ? 'bg-violet-500' : 'bg-gray-600'
                        }`}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${enabled ? 'translate-x-4' : 'translate-x-0'}`} />
                      </button>
                    </div>
                    {effect.key === 'depthOfField' && (
                      <div className="grid grid-cols-[1fr_140px] items-center gap-2">
                        <div className="text-[10px] text-gray-500 truncate">Focus target</div>
                        <select
                          value={viewportEffects.depthOfFieldFocusTarget}
                          onChange={(event) =>
                            updateViewportEffect(
                              'depthOfFieldFocusTarget',
                              event.target.value as ViewportEffects['depthOfFieldFocusTarget'],
                            )
                          }
                          disabled={!enabled}
                          className="w-full rounded-md border border-[#2a2a34] bg-[#121218] px-2 py-1.5 text-[11px] text-gray-200 focus:outline-none focus:ring-1 focus:ring-violet-500 disabled:opacity-40"
                        >
                          <option value="pmx">Full PMX</option>
                        </select>
                      </div>
                    )}
                    <div className="grid grid-cols-[1fr_40px] items-center gap-2">
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={strength}
                        disabled={!enabled}
                        onChange={(event) => updateViewportEffect(effect.strengthKey, Number(event.target.value))}
                        className="w-full h-1 bg-[#272730] rounded-full appearance-none cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-violet-500 [&::-webkit-slider-thumb]:hover:bg-violet-400"
                      />
                      <span className="text-[10px] text-gray-400 text-right font-mono">
                        {Math.round(strength * 100)}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Export Panel */}
        <div className={`flex-1 overflow-y-auto p-4 space-y-4 ${activeTab === 'export' ? 'block' : 'hidden'}`} style={{ scrollbarGutter: 'stable' }}>
          <div className="rounded-xl border border-[#272730] bg-[#16161d] p-4 space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-300">Frame Export</h3>
            <p className="text-[11px] text-gray-500 leading-relaxed">
              Export either all timeline frames or only frame 0 as PNG files inside a ZIP.
            </p>
          </div>

          <div className="rounded-xl border border-[#272730] bg-[#16161d] p-4 space-y-3">
            <div>
              <div className="text-sm font-semibold text-gray-100">Aspect Preset</div>
              <div className="text-[11px] text-gray-500 mt-0.5">Defaults to 9:16 for vertical delivery.</div>
            </div>
            <select
              value={exportSettings.aspectPreset}
              disabled={isExporting}
              onChange={(event) => handleExportAspectPreset(event.target.value as ExportAspectPreset)}
              className="w-full rounded-md border border-[#2a2a34] bg-[#121218] px-2 py-2 text-xs text-gray-200 focus:outline-none focus:ring-2 focus:ring-violet-500"
            >
              <option value="9:16">9:16 (1080×1920)</option>
              <option value="16:9">16:9 (1920×1080)</option>
              <option value="1:1">1:1 (1080×1080)</option>
              <option value="4:5">4:5 (1080×1350)</option>
            </select>
          </div>

          <div className="rounded-xl border border-[#272730] bg-[#16161d] p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-[11px] text-gray-400">Width</span>
                <input
                  type="number"
                  min={2}
                  disabled={isExporting}
                  value={exportSettings.width}
                  onChange={(event) => updateExportSetting('width', Math.max(2, Number(event.target.value) || 2))}
                  className="w-full rounded-md border border-[#2a2a34] bg-[#121218] px-2 py-2 text-xs text-gray-200 focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] text-gray-400">Height</span>
                <input
                  type="number"
                  min={2}
                  disabled={isExporting}
                  value={exportSettings.height}
                  onChange={(event) => updateExportSetting('height', Math.max(2, Number(event.target.value) || 2))}
                  className="w-full rounded-md border border-[#2a2a34] bg-[#121218] px-2 py-2 text-xs text-gray-200 focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </label>
            </div>

            <label className="space-y-1 block">
              <span className="text-[11px] text-gray-400">Export FPS</span>
              <input
                type="number"
                min={1}
                max={120}
                disabled={isExporting}
                value={exportSettings.fps}
                onChange={(event) => updateExportSetting('fps', Math.min(120, Math.max(1, Number(event.target.value) || 1)))}
                className="w-full rounded-md border border-[#2a2a34] bg-[#121218] px-2 py-2 text-xs text-gray-200 focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </label>

            <div className="rounded-md border border-[#2a2a34] bg-[#121218] px-2 py-2 text-[11px] text-gray-300">
              <span className="text-gray-400">Output:</span> ZIP archive with PNG frames (`frames/frame_000000.png`, ...)
            </div>
          </div>

          <div className="rounded-xl border border-[#272730] bg-[#16161d] p-4 space-y-3">
            <Button
              size="sm"
              className="h-9 w-full text-xs font-medium bg-violet-600 hover:bg-violet-500 text-white"
              disabled={isExporting}
              onClick={() => void handleExportVideo()}
            >
              {isExporting ? 'Exporting...' : 'Export All Frames to ZIP'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-9 w-full text-xs font-medium border-[#32323e] bg-[#1a1a24] hover:bg-violet-500/20 hover:border-violet-500/40 hover:text-white"
              disabled={isExporting}
              onClick={() => void handleExportFirstFrame()}
            >
              Export First Frame to ZIP
            </Button>
            {isExporting && (
              <div className="space-y-1">
                <div className="h-1.5 rounded-full bg-[#272730] overflow-hidden">
                  <div
                    className="h-full bg-violet-500 transition-all"
                    style={{ width: `${Math.round(exportProgress * 100)}%` }}
                  />
                </div>
                <div className="text-[11px] text-gray-400">{Math.round(exportProgress * 100)}%</div>
              </div>
            )}
            {exportStatus && (
              <div className="text-[11px] text-gray-400">{exportStatus}</div>
            )}
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#09090b]">
        {/* Top Toolbar */}
        <div className="h-12 bg-[#121217] border-b border-[#272730] flex items-center px-4 justify-between z-10 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#1a1a24] border border-[#272730]">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="text-xs font-medium text-gray-200">Scene Active</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              className="h-8 px-5 text-xs font-medium border-0 shadow-sm bg-violet-600 hover:bg-violet-500 text-white"
              disabled={isExporting}
              onClick={() => void handleExportVideo()}
            >
              <><Archive className="w-3.5 h-3.5 mr-1.5" /> Export ZIP</>
            </Button>
          </div>
        </div>

        {/* 3D Viewport */}
        <div className="flex-1 relative bg-[#09090b]">
          <ThreeScene
            characters={characters}
            activeCamera={activeRuntimeCamera}
            effects={viewportEffects}
            cameraTranslation={cameraTranslation}
            previewAspect={Math.max(exportSettings.width, 1) / Math.max(exportSettings.height, 1)}
            defaultStageVisible={defaultStageVisible}
            onSceneReady={(scene: THREE.Scene, camera: THREE.PerspectiveCamera, controls: OrbitControls, captureApi: ThreeSceneCaptureApi) => {
              sceneRef.current = scene;
              cameraRef.current = camera;
              controlsRef.current = controls;
              sceneCaptureApiRef.current = captureApi;
            }}
          />
          
          {/* Viewport Overlay Info */}
          <div className="absolute top-4 right-4 pointer-events-none flex flex-col items-end gap-2">
            <div className="bg-black/40 backdrop-blur-md border border-white/10 text-white/80 text-[10px] px-2 py-1 rounded font-mono">
              FPS: {fps}
            </div>
            <div className="bg-black/40 backdrop-blur-md border border-white/10 text-white/80 text-[10px] px-2 py-1 rounded font-mono">
              Frame: {currentFrame} / {timelineEndFrame}
            </div>
          </div>
        </div>

        {/* Bottom Timeline Panel */}
        <div className="shrink-0 z-10">
          <TimelinePanel
            currentFrame={currentFrame}
            maxFrame={timelineEndFrame}
            fps={fps}
            isPlaying={isPlaying}
            tracks={timelineTracks}
            disabled={!canPlay}
            onTogglePlay={() => {
              if (!canPlay) return;
              setIsPlaying((prev) => !prev);
            }}
            onStop={handleStopPlayback}
            onFrameChange={handleFrameChange}
            onStepFrame={handleStepFrame}
            onFpsChange={handleFpsChange}
            onMaxFrameChange={handleMaxFrameChange}
            onScrubStart={handleScrubStart}
            onScrubEnd={handleScrubEnd}
          />
        </div>
      </div>
    </div>
  );
}

export default App;
