import * as THREE from 'three';

/** Snapshot of MeshPhysicalMaterial fields we animate with the strength slider. */
export type MeshPhysicalBaseline = {
  roughness: number;
  metalness: number;
  envMapIntensity: number;
  clearcoat: number;
  clearcoatRoughness: number;
  sheen: number;
  sheenRoughness: number;
  specularIntensity: number;
  ior: number;
};

const BASELINE_KEY = '__pbrBaseline';
const STANDARD_BASELINE_KEY = '__standardBaseline';
const PHONG_BASELINE_KEY = '__phongBaseline';
const LAMBERT_BASELINE_KEY = '__lambertBaseline';
const TOON_BASELINE_KEY = '__toonBaseline';
const MATCAP_BASELINE_KEY = '__matcapBaseline';

type CharacterMaterialMode = 'physical' | 'standard' | 'phong' | 'lambert' | 'toon' | 'matcap';
/** `userData` key for original materials before promoting to MeshPhysicalMaterial. */
export const CHARACTER_MESH_PHYSICAL_BACKUP_KEY = '__meshPhysicalCharacterBackup';
const CHARACTER_MATERIAL_MODE_KEY = '__characterMaterialMode';
/** @deprecated Previous key; still read/cleared for one-session compatibility. */
const LEGACY_CHARACTER_PHYSICAL_BACKUP_KEY = '__principledMMDBackup';

function getStoredPhysicalBackup(obj: THREE.Mesh): THREE.Material | THREE.Material[] | undefined {
  const next = obj.userData[CHARACTER_MESH_PHYSICAL_BACKUP_KEY];
  if (next !== undefined) {
    return next;
  }
  return obj.userData[LEGACY_CHARACTER_PHYSICAL_BACKUP_KEY];
}

function deletePhysicalBackupKeys(obj: THREE.Mesh) {
  delete obj.userData[CHARACTER_MESH_PHYSICAL_BACKUP_KEY];
  delete obj.userData[LEGACY_CHARACTER_PHYSICAL_BACKUP_KEY];
}

/** MMD toon is ShaderMaterial with MeshPhong-like map fields at runtime; typings omit them. */
export type MmdToonShaderSurface = THREE.ShaderMaterial & {
  isMMDToonMaterial: true;
  map?: THREE.Texture | null;
  /** Same backing uniform as `color` (Phong-style name). */
  diffuse?: THREE.Color;
  color?: THREE.Color;
  matcap?: THREE.Texture | null;
  /** MMD sphere map blend: `AddOperation` (eye highlights) vs multiply (.sph). */
  matcapCombine?: number;
  emissive?: THREE.Color;
  emissiveMap?: THREE.Texture | null;
  emissiveIntensity?: number;
  normalMap?: THREE.Texture | null;
  normalMapType?: THREE.NormalMapTypes;
  normalScale?: THREE.Vector2;
  bumpMap?: THREE.Texture | null;
  bumpScale?: number;
  alphaMap?: THREE.Texture | null;
  aoMap?: THREE.Texture | null;
  aoMapIntensity?: number;
  lightMap?: THREE.Texture | null;
  lightMapIntensity?: number;
  specular?: THREE.Color;
  shininess?: number;
};

export function isMmdToonMaterial(m: THREE.Material): m is MmdToonShaderSurface {
  return (
    'isMMDToonMaterial' in m &&
    (m as THREE.ShaderMaterial & { isMMDToonMaterial?: boolean }).isMMDToonMaterial === true
  );
}

function linearLuminance(c: THREE.Color): number {
  return c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
}

/**
 * MMD toon often keeps diffuse near black and lets matcap + gradient / ramp carry the look.
 * MeshPhysical has no matcap; without lifting albedo, the mesh reads as black.
 */
function mmdBaseColorForPhysical(mmd: MmdToonShaderSurface): THREE.Color {
  const raw =
    mmd.diffuse?.clone?.() ??
    mmd.color?.clone?.() ??
    new THREE.Color(0xffffff);
  const lum = linearLuminance(raw);
  const hasMap = !!mmd.map;
  const hasMatcap = !!mmd.matcap;

  if (hasMap && lum < 0.12) {
    return new THREE.Color(0xffffff);
  }
  if (hasMatcap && lum < 0.1) {
    if (hasMap) {
      return new THREE.Color(0xffffff);
    }
    return new THREE.Color(0.88, 0.88, 0.9);
  }
  return raw;
}

function mmdMatcapStyleParams(mmd: MmdToonShaderSurface, baseLum: number): {
  metalness: number;
  roughnessMul: number;
  envBoost: number;
  clearcoat: number;
} {
  const hasMatcap = !!mmd.matcap;
  if (!hasMatcap || baseLum >= 0.1 || mmd.map) {
    return { metalness: 0.02, roughnessMul: 1, envBoost: 1, clearcoat: 0 };
  }
  return {
    metalness: THREE.MathUtils.clamp(0.22 + (0.1 - baseLum) * 2, 0.15, 0.55),
    roughnessMul: 0.65,
    envBoost: 1.45,
    clearcoat: 0.35,
  };
}

function mmdSafeEmissive(mmd: MmdToonShaderSurface): {
  emissive: THREE.Color;
  emissiveMap?: THREE.Texture | null;
  emissiveIntensity: number;
} {
  // Stock MMD mapping uses PMX "ambient" as `emissive`. Under real lights + IBL this can blow out,
  // so keep emissive only when the material explicitly has an emissiveMap.
  const hasEmissiveMap = !!mmd.emissiveMap;
  return {
    emissive: hasEmissiveMap ? (mmd.emissive?.clone?.() ?? new THREE.Color(0xffffff)) : new THREE.Color(0x000000),
    emissiveMap: mmd.emissiveMap ?? null,
    emissiveIntensity: hasEmissiveMap ? Math.min(mmd.emissiveIntensity ?? 1, 0.6) : 0,
  };
}

/** PMX MMD toon → MeshPhysicalMaterial (metallic-roughness). Requires scene.environment (IBL). */
export function mmdToonToPhysical(mmd: MmdToonShaderSurface): THREE.MeshPhysicalMaterial {
  const shininess = mmd.shininess ?? 30;
  const roughFromSpec = THREE.MathUtils.clamp(0.75 - Math.log10(shininess + 1) * 0.35, 0.18, 0.82);

  const baseColor = mmdBaseColorForPhysical(mmd);
  const baseLum = linearLuminance(
    mmd.diffuse ?? mmd.color ?? new THREE.Color(0xffffff),
  );
  const matcapHints = mmdMatcapStyleParams(mmd, baseLum);

  const matcapTex = mmd.matcap ?? null;
  const matcapCombine = mmd.matcapCombine ?? THREE.AddOperation;
  const hasMatcapForEnv = !!matcapTex;
  const safeEmissive = mmdSafeEmissive(mmd);

  const phys = new THREE.MeshPhysicalMaterial({
    map: mmd.map,
    color: baseColor,
    emissive: safeEmissive.emissive,
    emissiveMap: safeEmissive.emissiveMap ?? undefined,
    emissiveIntensity: safeEmissive.emissiveIntensity,
    transmission: 0,
    thickness: 0,
    attenuationDistance: Infinity,
    normalMap: mmd.normalMap,
    normalMapType: mmd.normalMapType ?? THREE.TangentSpaceNormalMap,
    normalScale: mmd.normalScale?.clone?.() ?? new THREE.Vector2(1, 1),
    bumpMap: mmd.bumpMap,
    bumpScale: mmd.bumpScale,
    alphaMap: mmd.alphaMap,
    aoMap: mmd.aoMap,
    aoMapIntensity: mmd.aoMapIntensity,
    lightMap: mmd.lightMap,
    lightMapIntensity: mmd.lightMapIntensity,
    transparent: mmd.transparent,
    opacity: mmd.opacity,
    side: mmd.side,
    alphaTest: mmd.alphaTest,
    depthWrite: mmd.depthWrite,
    depthTest: mmd.depthTest,
    roughness: THREE.MathUtils.clamp(roughFromSpec * matcapHints.roughnessMul, 0.08, 1),
    metalness: matcapHints.metalness,
    specularIntensity: 1,
    specularColor:
      mmd.specular && typeof mmd.specular.clone === 'function'
        ? mmd.specular.clone()
        : new THREE.Color(0x111111),
    ior: 1.5,
    // Keep IBL modest; scene already has multiple direct lights + ACES tone mapping.
    envMapIntensity: hasMatcapForEnv && !mmd.map
      ? Math.min(1.1 * matcapHints.envBoost, 1.05)
      : Math.min(0.85 * matcapHints.envBoost, 0.95),
    clearcoat: matcapHints.clearcoat,
    clearcoatRoughness: 0.28,
    sheen: 0.12,
    sheenRoughness: 0.55,
    sheenColor: new THREE.Color(0xffffff),
  });

  // Do not enable vertexColors from geometry alone: PMX often ships a color attribute that is
  // unused by MMD toon but would multiply MeshPhysical albedo to zero/black.

  // Keep NormalBlending (default). MMDLoader's CustomBlending + DstAlphaFactor fights
  // EffectComposer half-float targets and can write black; toon ShaderMaterial path differs.

  if (phys.map) {
    phys.map.colorSpace = THREE.SRGBColorSpace;
  }
  if (phys.emissiveMap) {
    phys.emissiveMap.colorSpace = THREE.SRGBColorSpace;
  }
  if (phys.lightMap) {
    phys.lightMap.colorSpace = THREE.SRGBColorSpace;
  }

  // MeshPhysical has no matcap slot; reuse sphere map as env + (optional) emissive so iris detail survives.
  if (matcapTex) {
    const envTex = matcapTex.clone();
    envTex.mapping = THREE.EquirectangularReflectionMapping;
    envTex.colorSpace = THREE.SRGBColorSpace;
    envTex.needsUpdate = true;
    phys.envMap = envTex;
    // Textured eyes rely on envMap; emissive matcap only when there is no albedo map (avoids double iris).
    if (matcapCombine === THREE.AddOperation && !mmd.emissiveMap && !mmd.map) {
      const emTex = matcapTex.clone();
      emTex.mapping = THREE.EquirectangularReflectionMapping;
      emTex.colorSpace = THREE.SRGBColorSpace;
      emTex.needsUpdate = true;
      phys.emissiveMap = emTex;
      phys.emissive = mmd.emissive?.clone?.() ?? new THREE.Color(0xffffff);
      phys.emissiveIntensity = 0.3;
    }
  }

  phys.userData[BASELINE_KEY] = snapshotPhysicalBaseline(phys);
  return phys;
}

export function snapshotPhysicalBaseline(m: THREE.MeshPhysicalMaterial): MeshPhysicalBaseline {
  return {
    roughness: m.roughness,
    metalness: m.metalness,
    envMapIntensity: m.envMapIntensity,
    clearcoat: m.clearcoat,
    clearcoatRoughness: m.clearcoatRoughness,
    sheen: m.sheen,
    sheenRoughness: m.sheenRoughness,
    specularIntensity: m.specularIntensity,
    ior: m.ior,
  };
}

export function ensurePhysicalBaseline(m: THREE.MeshPhysicalMaterial) {
  if (!m.userData[BASELINE_KEY]) {
    m.userData[BASELINE_KEY] = snapshotPhysicalBaseline(m);
  }
}

/** Interpolate MeshPhysicalMaterial parameters toward a stronger IBL / clearcoat / sheen look (t ∈ [0,1]). */
export function applyMeshPhysicalStrength(m: THREE.MeshPhysicalMaterial, t: number) {
  const base = m.userData[BASELINE_KEY] as MeshPhysicalBaseline | undefined;
  if (!base) {
    return;
  }
  const c = THREE.MathUtils.clamp(t, 0, 1);
  m.roughness = THREE.MathUtils.lerp(base.roughness, 0.18, c);
  m.metalness = THREE.MathUtils.lerp(base.metalness, THREE.MathUtils.clamp(base.metalness + 0.42, 0, 1), c);
  m.envMapIntensity = THREE.MathUtils.lerp(base.envMapIntensity, 1.35, c);
  m.clearcoat = THREE.MathUtils.lerp(base.clearcoat, 0.35, c);
  m.clearcoatRoughness = THREE.MathUtils.lerp(base.clearcoatRoughness, 0.2, c);
  m.sheen = THREE.MathUtils.lerp(base.sheen, 0.22, c);
  m.sheenRoughness = THREE.MathUtils.lerp(base.sheenRoughness, 0.5, c);
  m.specularIntensity = THREE.MathUtils.lerp(base.specularIntensity, 1.1, c);
  m.ior = THREE.MathUtils.lerp(base.ior, 1.4, c);
  m.needsUpdate = true;
}

function promoteStandardToPhysical(mat: THREE.MeshStandardMaterial): THREE.MeshPhysicalMaterial {
  const phys = new THREE.MeshPhysicalMaterial();
  try {
    phys.copy(mat);
  } catch {
    // three.js internals can throw during `copy()` if some optional vector props
    // are unexpectedly undefined in the source material. Do a conservative
    // manual transfer instead.
    phys.color.copy(mat.color);
    phys.map = mat.map;
    phys.emissive.copy(mat.emissive);
    phys.emissiveMap = mat.emissiveMap;
    phys.emissiveIntensity = mat.emissiveIntensity;

    phys.normalMap = mat.normalMap;
    phys.normalMapType = mat.normalMapType;
    phys.normalScale.copy(mat.normalScale ?? new THREE.Vector2(1, 1));

    phys.bumpMap = mat.bumpMap;
    phys.bumpScale = mat.bumpScale;

    phys.alphaMap = mat.alphaMap;
    phys.aoMap = mat.aoMap;
    phys.aoMapIntensity = mat.aoMapIntensity;
    phys.lightMap = mat.lightMap;
    phys.lightMapIntensity = mat.lightMapIntensity;

    phys.transparent = mat.transparent;
    phys.opacity = mat.opacity;
    phys.side = mat.side;
    phys.alphaTest = mat.alphaTest;
    phys.depthWrite = mat.depthWrite;
    phys.depthTest = mat.depthTest;

    phys.roughness = mat.roughness;
    phys.metalness = mat.metalness;
    phys.envMap = mat.envMap;
    phys.envMapIntensity = mat.envMapIntensity;
  }

  if (!Number.isFinite(phys.attenuationDistance)) {
    phys.attenuationDistance = Infinity;
  }
  phys.userData[BASELINE_KEY] = snapshotPhysicalBaseline(phys);
  return phys;
}

function mmdToonToStandard(mmd: MmdToonShaderSurface): THREE.MeshStandardMaterial {
  const shininess = mmd.shininess ?? 30;
  const roughFromSpec = THREE.MathUtils.clamp(0.75 - Math.log10(shininess + 1) * 0.35, 0.18, 0.82);

  const baseLum = linearLuminance(mmd.diffuse ?? mmd.color ?? new THREE.Color(0xffffff));
  const matcapHints = mmdMatcapStyleParams(mmd, baseLum);
  const baseColor = mmdBaseColorForPhysical(mmd);
  const matcapTex = mmd.matcap ?? null;
  const hasMatcapForEnv = !!matcapTex;
  const safeEmissive = mmdSafeEmissive(mmd);

  const standard = new THREE.MeshStandardMaterial({
    map: mmd.map ?? undefined,
    color: baseColor,
    emissive: safeEmissive.emissive,
    emissiveMap: safeEmissive.emissiveMap ?? undefined,
    emissiveIntensity: safeEmissive.emissiveIntensity,
    normalMap: mmd.normalMap ?? undefined,
    normalMapType: mmd.normalMapType ?? THREE.TangentSpaceNormalMap,
    normalScale: mmd.normalScale?.clone?.() ?? new THREE.Vector2(1, 1),
    bumpMap: mmd.bumpMap ?? undefined,
    bumpScale: mmd.bumpScale,
    alphaMap: mmd.alphaMap ?? undefined,
    aoMap: mmd.aoMap ?? undefined,
    aoMapIntensity: mmd.aoMapIntensity,
    lightMap: mmd.lightMap ?? undefined,
    lightMapIntensity: mmd.lightMapIntensity,
    transparent: mmd.transparent,
    opacity: mmd.opacity,
    side: mmd.side,
    alphaTest: mmd.alphaTest,
    depthWrite: mmd.depthWrite,
    depthTest: mmd.depthTest,
    roughness: THREE.MathUtils.clamp(roughFromSpec * matcapHints.roughnessMul, 0.08, 1),
    metalness: matcapHints.metalness,
    envMapIntensity: hasMatcapForEnv && !mmd.map
      ? Math.min(1.1 * matcapHints.envBoost, 1.05)
      : Math.min(0.85 * matcapHints.envBoost, 0.95),
  });

  // Ensure correct color spaces.
  if (standard.map) standard.map.colorSpace = THREE.SRGBColorSpace;
  if (standard.emissiveMap) standard.emissiveMap.colorSpace = THREE.SRGBColorSpace;
  if (standard.lightMap) standard.lightMap.colorSpace = THREE.SRGBColorSpace;
  if (standard.aoMap) {
    // AO is usually linear data; don't force sRGB.
    standard.aoMap.colorSpace = THREE.NoColorSpace;
  }

  // Preserve matcap-driven iris highlights by using the matcap as an envMap reflection.
  if (matcapTex) {
    const envTex = matcapTex.clone();
    envTex.mapping = THREE.EquirectangularReflectionMapping;
    envTex.colorSpace = THREE.SRGBColorSpace;
    envTex.needsUpdate = true;
    standard.envMap = envTex;
  }

  return standard;
}

function mmdToonToPhong(mmd: MmdToonShaderSurface): THREE.MeshPhongMaterial {
  const shininess = mmd.shininess ?? 30;
  const baseColor = mmdBaseColorForPhysical(mmd);
  const specular = mmd.specular?.clone?.() ?? new THREE.Color(0x111111);
  const safeEmissive = mmdSafeEmissive(mmd);

  const phong = new THREE.MeshPhongMaterial({
    map: mmd.map ?? undefined,
    color: baseColor,
    emissive: safeEmissive.emissive,
    emissiveMap: safeEmissive.emissiveMap ?? undefined,
    emissiveIntensity: safeEmissive.emissiveIntensity,
    normalMap: mmd.normalMap ?? undefined,
    normalMapType: mmd.normalMapType ?? THREE.TangentSpaceNormalMap,
    normalScale: mmd.normalScale?.clone?.() ?? new THREE.Vector2(1, 1),
    bumpMap: mmd.bumpMap ?? undefined,
    bumpScale: mmd.bumpScale,
    alphaMap: mmd.alphaMap ?? undefined,
    aoMap: mmd.aoMap ?? undefined,
    aoMapIntensity: mmd.aoMapIntensity,
    lightMap: mmd.lightMap ?? undefined,
    lightMapIntensity: mmd.lightMapIntensity,
    transparent: mmd.transparent,
    opacity: mmd.opacity,
    side: mmd.side,
    alphaTest: mmd.alphaTest,
    depthWrite: mmd.depthWrite,
    depthTest: mmd.depthTest,
    shininess,
    specular,
  });

  if (phong.map) phong.map.colorSpace = THREE.SRGBColorSpace;
  if (phong.emissiveMap) phong.emissiveMap.colorSpace = THREE.SRGBColorSpace;
  if (phong.lightMap) phong.lightMap.colorSpace = THREE.SRGBColorSpace;

  // Approximate matcap shading with reflection env.
  if (mmd.matcap) {
    const envTex = mmd.matcap.clone();
    envTex.mapping = THREE.EquirectangularReflectionMapping;
    envTex.colorSpace = THREE.SRGBColorSpace;
    envTex.needsUpdate = true;
    phong.envMap = envTex;
    phong.reflectivity = 0.55;
  }

  return phong;
}

function mmdToonToLambert(mmd: MmdToonShaderSurface): THREE.MeshLambertMaterial {
  const baseColor = mmdBaseColorForPhysical(mmd);
  const safeEmissive = mmdSafeEmissive(mmd);
  const lambert = new THREE.MeshLambertMaterial({
    map: mmd.map ?? undefined,
    color: baseColor,
    emissive: safeEmissive.emissive,
    emissiveMap: safeEmissive.emissiveMap ?? undefined,
    emissiveIntensity: safeEmissive.emissiveIntensity,
    normalMap: mmd.normalMap ?? undefined,
    normalMapType: mmd.normalMapType ?? THREE.TangentSpaceNormalMap,
    normalScale: mmd.normalScale?.clone?.() ?? new THREE.Vector2(1, 1),
    bumpMap: mmd.bumpMap ?? undefined,
    bumpScale: mmd.bumpScale,
    alphaMap: mmd.alphaMap ?? undefined,
    aoMap: mmd.aoMap ?? undefined,
    aoMapIntensity: mmd.aoMapIntensity,
    lightMap: mmd.lightMap ?? undefined,
    lightMapIntensity: mmd.lightMapIntensity,
    transparent: mmd.transparent,
    opacity: mmd.opacity,
    side: mmd.side,
    alphaTest: mmd.alphaTest,
    depthWrite: mmd.depthWrite,
    depthTest: mmd.depthTest,
  });

  if (lambert.map) lambert.map.colorSpace = THREE.SRGBColorSpace;
  if (lambert.emissiveMap) lambert.emissiveMap.colorSpace = THREE.SRGBColorSpace;
  if (lambert.lightMap) lambert.lightMap.colorSpace = THREE.SRGBColorSpace;

  return lambert;
}

function mmdToonToToon(mmd: MmdToonShaderSurface): THREE.MeshToonMaterial {
  // Safety-first: keep MeshToonMaterial shader permutations minimal to avoid
  // WebGL shader compile/context issues seen with more complex map combos.
  const baseColor = mmdBaseColorForPhysical(mmd);
  // MeshToonMaterial in this three.js version does not support `specular`/`shininess`.
  // So the toon "strength" is driven by emissiveIntensity (and color/emissive), not Phong-like params.
  const toon = new THREE.MeshToonMaterial({
    map: mmd.map ?? null,
    color: baseColor,
    emissive: mmd.emissive?.clone?.() ?? new THREE.Color(0x000000),
    emissiveMap: mmd.emissiveMap ?? null,
    emissiveIntensity: mmd.emissiveIntensity ?? 1,
    transparent: mmd.transparent,
    opacity: mmd.opacity,
    side: mmd.side,
    alphaTest: mmd.alphaTest,
    depthWrite: mmd.depthWrite,
    depthTest: mmd.depthTest,
  });

  if (toon.map) toon.map.colorSpace = THREE.SRGBColorSpace;
  if (toon.emissiveMap) toon.emissiveMap.colorSpace = THREE.SRGBColorSpace;

  return toon;
}

function mmdToonToMatcap(mmd: MmdToonShaderSurface): THREE.Material {
  if (!mmd.matcap) {
    // No matcap texture available; fall back to a safe diffuse model to avoid black output.
    return mmdToonToLambert(mmd);
  }

  const baseColor = mmdBaseColorForPhysical(mmd);
  const matcap = mmd.matcap.clone();
  matcap.colorSpace = THREE.SRGBColorSpace;
  matcap.needsUpdate = true;

  const matcapMat = new THREE.MeshMatcapMaterial({
    matcap,
    color: baseColor,
    transparent: mmd.transparent,
    opacity: mmd.opacity,
    side: mmd.side,
    depthWrite: mmd.depthWrite,
  });

  matcapMat.depthTest = mmd.depthTest;
  // MeshMatcapMaterial doesn't support alphaTest in the same way; leave defaults for stability.
  return matcapMat;
}

function promotePhysicalToStandard(mat: THREE.MeshPhysicalMaterial): THREE.MeshStandardMaterial {
  const standard = new THREE.MeshStandardMaterial();
  standard.copy(mat);
  return standard;
}

function standardToPhong(m: THREE.MeshStandardMaterial): THREE.MeshPhongMaterial {
  const phong = new THREE.MeshPhongMaterial({
    map: m.map ?? undefined,
    color: m.color.clone(),
    emissive: m.emissive.clone(),
    emissiveMap: m.emissiveMap ?? undefined,
    emissiveIntensity: m.emissiveIntensity,
    normalMap: m.normalMap ?? undefined,
    normalMapType: m.normalMapType ?? THREE.TangentSpaceNormalMap,
    normalScale: m.normalScale?.clone?.() ?? new THREE.Vector2(1, 1),
    bumpMap: m.bumpMap ?? undefined,
    bumpScale: m.bumpScale,
    alphaMap: m.alphaMap ?? undefined,
    transparent: m.transparent,
    opacity: m.opacity,
    side: m.side,
    alphaTest: m.alphaTest,
    depthWrite: m.depthWrite,
    depthTest: m.depthTest,
    shininess: THREE.MathUtils.clamp(10 + (1 - m.roughness) * 1960, 10, 2048),
    specular: new THREE.Color(0xffffff).multiplyScalar(THREE.MathUtils.clamp(0.15 + m.metalness, 0, 1)),
  });

  phong.envMap = m.envMap ?? null;
  phong.reflectivity = m.envMapIntensity;

  return phong;
}

function standardToLambert(m: THREE.MeshStandardMaterial): THREE.MeshLambertMaterial {
  const lambert = new THREE.MeshLambertMaterial({
    map: m.map ?? undefined,
    color: m.color.clone(),
    emissive: m.emissive.clone(),
    emissiveMap: m.emissiveMap ?? undefined,
    emissiveIntensity: m.emissiveIntensity,
    normalMap: m.normalMap ?? undefined,
    normalMapType: m.normalMapType ?? THREE.TangentSpaceNormalMap,
    normalScale: m.normalScale?.clone?.() ?? new THREE.Vector2(1, 1),
    bumpMap: m.bumpMap ?? undefined,
    bumpScale: m.bumpScale,
    alphaMap: m.alphaMap ?? undefined,
    transparent: m.transparent,
    opacity: m.opacity,
    side: m.side,
    alphaTest: m.alphaTest,
    depthWrite: m.depthWrite,
    depthTest: m.depthTest,
  });

  return lambert;
}

function standardToToon(m: THREE.MeshStandardMaterial): THREE.MeshToonMaterial {
  // Same safety approach as MMD toon conversion: minimal maps.
  const toon = new THREE.MeshToonMaterial({
    map: m.map ?? null,
    color: m.color.clone(),
    emissive: m.emissive.clone(),
    emissiveMap: m.emissiveMap ?? null,
    emissiveIntensity: m.emissiveIntensity,
    transparent: m.transparent,
    opacity: m.opacity,
    side: m.side,
    alphaTest: m.alphaTest,
    depthWrite: m.depthWrite,
    depthTest: m.depthTest,
  });

  if (toon.map) toon.map.colorSpace = THREE.SRGBColorSpace;
  if (toon.emissiveMap) toon.emissiveMap.colorSpace = THREE.SRGBColorSpace;

  return toon;
}

function convertMaterialForCharacterMode(source: THREE.Material, mode: CharacterMaterialMode): THREE.Material {
  if (isMmdToonMaterial(source)) {
    switch (mode) {
      case 'physical':
        return mmdToonToPhysical(source);
      case 'standard':
        return mmdToonToStandard(source);
      case 'phong':
        return mmdToonToPhong(source);
      case 'lambert':
        return mmdToonToLambert(source);
      case 'toon':
        try {
          return mmdToonToToon(source);
        } catch {
          // Fallback: classic physically safe look
          return mmdToonToPhysical(source);
        }
      case 'matcap':
        return mmdToonToMatcap(source);
    }
  }

  if (mode === 'physical') {
    if (source instanceof THREE.MeshPhysicalMaterial) {
      ensurePhysicalBaseline(source);
      return source;
    }
    if (source instanceof THREE.MeshStandardMaterial) {
      return promoteStandardToPhysical(source);
    }
    return source;
  }

  if (mode === 'standard') {
    if (source instanceof THREE.MeshStandardMaterial) return source;
    if (source instanceof THREE.MeshPhysicalMaterial) return promotePhysicalToStandard(source);
    return source;
  }

  // Classic lighting modes: best-effort conversions from Standard.
  if (source instanceof THREE.MeshStandardMaterial) {
    switch (mode) {
      case 'phong':
        return standardToPhong(source);
      case 'lambert':
        return standardToLambert(source);
      case 'toon':
        try {
          return standardToToon(source);
        } catch {
          return source;
        }
      case 'matcap':
        // Without a matcap texture, matcap mode can go black; keep Standard instead.
        return source;
    }
  }

  if (source instanceof THREE.MeshPhysicalMaterial) {
    // Use shared fields; keep it simple and safe.
    if (mode === 'phong') return standardToPhong(source as unknown as THREE.MeshStandardMaterial);
    if (mode === 'lambert') return standardToLambert(source as unknown as THREE.MeshStandardMaterial);
    if (mode === 'toon') return standardToToon(source as unknown as THREE.MeshStandardMaterial);
    if (mode === 'matcap') return source; // no matcap available here
    return source;
  }

  return source;
}

function ensureStandardBaseline(m: THREE.MeshStandardMaterial) {
  if (m.userData[STANDARD_BASELINE_KEY]) return;
  m.userData[STANDARD_BASELINE_KEY] = {
    roughness: m.roughness,
    metalness: m.metalness,
    envMapIntensity: m.envMapIntensity,
  };
}

function applyMeshStandardStrength(m: THREE.MeshStandardMaterial, strength: number) {
  const t = THREE.MathUtils.clamp(strength, 0, 1);
  const base = m.userData[STANDARD_BASELINE_KEY] as { roughness: number; metalness: number; envMapIntensity: number };
  m.roughness = THREE.MathUtils.lerp(base.roughness, Math.max(base.roughness * 0.72, 0.04), t);
  m.metalness = THREE.MathUtils.lerp(base.metalness, Math.min(base.metalness + 0.25, 1), t);
  m.envMapIntensity = THREE.MathUtils.lerp(base.envMapIntensity, Math.max(base.envMapIntensity * 1.5, 0), t);
  m.needsUpdate = true;
}

function ensurePhongBaseline(m: THREE.MeshPhongMaterial) {
  if (m.userData[PHONG_BASELINE_KEY]) return;
  m.userData[PHONG_BASELINE_KEY] = {
    shininess: m.shininess,
    specular: m.specular.clone(),
  };
}

function applyMeshPhongStrength(m: THREE.MeshPhongMaterial, strength: number) {
  const t = THREE.MathUtils.clamp(strength, 0, 1);
  const base = m.userData[PHONG_BASELINE_KEY] as { shininess: number; specular: THREE.Color };
  m.shininess = THREE.MathUtils.lerp(base.shininess, Math.min(base.shininess * 1.35 + 20, 2048), t);
  const scale = THREE.MathUtils.lerp(1, 1.35, t);
  m.specular.copy(base.specular).multiplyScalar(scale);
  m.needsUpdate = true;
}

function ensureLambertBaseline(m: THREE.MeshLambertMaterial) {
  if (m.userData[LAMBERT_BASELINE_KEY]) return;
  m.userData[LAMBERT_BASELINE_KEY] = {
    emissiveIntensity: m.emissiveIntensity,
    emissive: m.emissive.clone(),
  };
}

function applyMeshLambertStrength(m: THREE.MeshLambertMaterial, strength: number) {
  const t = THREE.MathUtils.clamp(strength, 0, 1);
  const base = m.userData[LAMBERT_BASELINE_KEY] as { emissiveIntensity: number; emissive: THREE.Color };
  m.emissiveIntensity = THREE.MathUtils.lerp(base.emissiveIntensity, base.emissiveIntensity * 1.4 + 0.05, t);
  const scale = THREE.MathUtils.lerp(1, 1.12, t);
  m.emissive.copy(base.emissive).multiplyScalar(scale);
  m.needsUpdate = true;
}

function ensureToonBaseline(m: THREE.MeshToonMaterial) {
  if (m.userData[TOON_BASELINE_KEY]) return;
  m.userData[TOON_BASELINE_KEY] = {
    emissiveIntensity: m.emissiveIntensity,
    emissive: m.emissive.clone(),
  };
}

function applyMeshToonStrength(m: THREE.MeshToonMaterial, strength: number) {
  const t = THREE.MathUtils.clamp(strength, 0, 1);
  const base = m.userData[TOON_BASELINE_KEY] as { emissiveIntensity: number; emissive: THREE.Color };
  // ToonMaterial doesn't use Phong-style `specular`/`shininess`. Use emissive intensity as the safe "strength" driver.
  m.emissiveIntensity = THREE.MathUtils.lerp(base.emissiveIntensity, base.emissiveIntensity * 1.6 + 0.2, t);
  const scale = THREE.MathUtils.lerp(1, 1.35, t);
  m.emissive.copy(base.emissive).multiplyScalar(scale);
  m.needsUpdate = true;
}

function ensureMatcapBaseline(m: THREE.MeshMatcapMaterial) {
  if (m.userData[MATCAP_BASELINE_KEY]) return;
  m.userData[MATCAP_BASELINE_KEY] = {
    color: m.color.clone(),
  };
}

function applyMeshMatcapStrength(m: THREE.MeshMatcapMaterial, strength: number) {
  const t = THREE.MathUtils.clamp(strength, 0, 1);
  const base = m.userData[MATCAP_BASELINE_KEY] as { color: THREE.Color };
  const mul = THREE.MathUtils.lerp(1, 1.35, t);
  m.color.copy(base.color).multiplyScalar(mul);
  m.needsUpdate = true;
}

function applyStrengthToMeshMaterials(mesh: THREE.Mesh, strength: number) {
  const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of list) {
    if (m instanceof THREE.MeshPhysicalMaterial) {
      ensurePhysicalBaseline(m);
      applyMeshPhysicalStrength(m, strength);
      continue;
    }
    if (m instanceof THREE.MeshStandardMaterial) {
      ensureStandardBaseline(m);
      applyMeshStandardStrength(m, strength);
      continue;
    }
    if (m instanceof THREE.MeshPhongMaterial) {
      ensurePhongBaseline(m);
      applyMeshPhongStrength(m, strength);
      continue;
    }
    if (m instanceof THREE.MeshLambertMaterial) {
      ensureLambertBaseline(m);
      applyMeshLambertStrength(m, strength);
      continue;
    }
    if (m instanceof THREE.MeshToonMaterial) {
      ensureToonBaseline(m);
      applyMeshToonStrength(m, strength);
      continue;
    }
    if (m instanceof THREE.MeshMatcapMaterial) {
      ensureMatcapBaseline(m);
      applyMeshMatcapStrength(m, strength);
      continue;
    }
  }
}

/**
 * When enabled: backup MMD/Standard materials once, swap to MeshPhysicalMaterial, apply strength.
 * When disabled: restore backups and dispose generated physical materials.
 */
export function syncCharacterPhysicalMaterials(
  root: THREE.Object3D,
  enabled: boolean,
  strength: number,
  mode?: CharacterMaterialMode,
): void {
  const t = THREE.MathUtils.clamp(strength, 0, 1);
  const actualMode: CharacterMaterialMode = mode ?? 'physical';

  if (!enabled) {
    root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;

      const backup = getStoredPhysicalBackup(obj);
      if (backup === undefined) return;

      const current = obj.material;
      obj.material = backup;
      deletePhysicalBackupKeys(obj);
      delete obj.userData[CHARACTER_MATERIAL_MODE_KEY];

      const backups = Array.isArray(backup) ? backup : [backup];
      const currents = Array.isArray(current) ? current : [current];

      currents.forEach((m) => {
        if (backups.includes(m)) return;
        if (
          m instanceof THREE.MeshPhysicalMaterial ||
          m instanceof THREE.MeshStandardMaterial ||
          m instanceof THREE.MeshPhongMaterial ||
          m instanceof THREE.MeshLambertMaterial ||
          m instanceof THREE.MeshToonMaterial ||
          m instanceof THREE.MeshMatcapMaterial
        ) {
          m.dispose();
        }
      });
    });
    return;
  }

  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;

    const hadBackup = getStoredPhysicalBackup(obj) !== undefined;
    const storedMode = obj.userData[CHARACTER_MATERIAL_MODE_KEY] as CharacterMaterialMode | undefined;

    if (!hadBackup) {
      // Always back up first enable so we can restore and also support safe mode switching.
      delete obj.userData[LEGACY_CHARACTER_PHYSICAL_BACKUP_KEY];
      obj.userData[CHARACTER_MESH_PHYSICAL_BACKUP_KEY] = obj.material;
    }

    const currentBackup = getStoredPhysicalBackup(obj);
    if (!currentBackup) return;

    if (!storedMode || storedMode !== actualMode) {
      const sourceList = Array.isArray(currentBackup) ? [...currentBackup] : [currentBackup];
      const next = sourceList.map((m) => convertMaterialForCharacterMode(m, actualMode));

      obj.material = Array.isArray(obj.material) ? next : next[0]!;
      obj.userData[CHARACTER_MATERIAL_MODE_KEY] = actualMode;
    }

    applyStrengthToMeshMaterials(obj, t);
  });
}

const IBL_PORTRAIT_MAT_BASE_KEY = '__iblStudioPortraitPhysicalBaseline';

type PortraitMatSnap = {
  sheen: number;
  sheenRoughness: number;
  envMapIntensity: number;
  clearcoat: number;
};

/**
 * Softer portrait read without transmission/thickness: those trigger extra render passes that
 * often go black under EffectComposer. Sheen + clearcoat + IBL is enough for a path-style glow.
 */
export function syncIblStudioPortraitMaterials(
  root: THREE.Object3D,
  enabled: boolean,
  strength: number,
): void {
  const t = THREE.MathUtils.clamp(strength, 0, 1);

  if (!enabled || t <= 0) {
    root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) {
        return;
      }
      const list = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of list) {
        if (!(m instanceof THREE.MeshPhysicalMaterial)) {
          continue;
        }
        const snap = m.userData[IBL_PORTRAIT_MAT_BASE_KEY] as PortraitMatSnap | undefined;
        if (!snap) {
          continue;
        }
        m.sheen = snap.sheen;
        m.sheenRoughness = snap.sheenRoughness;
        m.envMapIntensity = snap.envMapIntensity;
        m.clearcoat = snap.clearcoat;
        delete m.userData[IBL_PORTRAIT_MAT_BASE_KEY];
        m.needsUpdate = true;
      }
    });
    return;
  }

  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) {
      return;
    }
    const list = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of list) {
      if (!(m instanceof THREE.MeshPhysicalMaterial)) {
        continue;
      }
      if (!m.userData[IBL_PORTRAIT_MAT_BASE_KEY]) {
        const snap: PortraitMatSnap = {
          sheen: m.sheen,
          sheenRoughness: m.sheenRoughness,
          envMapIntensity: m.envMapIntensity,
          clearcoat: m.clearcoat,
        };
        m.userData[IBL_PORTRAIT_MAT_BASE_KEY] = snap;
      }
      const b = m.userData[IBL_PORTRAIT_MAT_BASE_KEY] as PortraitMatSnap;
      m.sheen = THREE.MathUtils.lerp(b.sheen, 0.38, t);
      m.sheenRoughness = THREE.MathUtils.lerp(b.sheenRoughness, 0.48, t);
      m.envMapIntensity = THREE.MathUtils.lerp(b.envMapIntensity, b.envMapIntensity * 1.35, t);
      m.clearcoat = THREE.MathUtils.lerp(b.clearcoat, Math.max(b.clearcoat, 0.28), t);
      m.needsUpdate = true;
    }
  });
}
