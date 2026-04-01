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
/** `userData` key for original materials before promoting to MeshPhysicalMaterial. */
export const CHARACTER_MESH_PHYSICAL_BACKUP_KEY = '__meshPhysicalCharacterBackup';
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

  if (hasMap && lum < 0.04) {
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

/** PMX MMD toon → MeshPhysicalMaterial (metallic-roughness). Requires scene.environment (IBL). */
export function mmdToonToPhysical(mmd: MmdToonShaderSurface): THREE.MeshPhysicalMaterial {
  const shininess = mmd.shininess ?? 30;
  const roughFromSpec = THREE.MathUtils.clamp(0.75 - Math.log10(shininess + 1) * 0.35, 0.18, 0.82);

  const baseColor = mmdBaseColorForPhysical(mmd);
  const baseLum = linearLuminance(
    mmd.diffuse ?? mmd.color ?? new THREE.Color(0xffffff),
  );
  const matcapHints = mmdMatcapStyleParams(mmd, baseLum);

  const phys = new THREE.MeshPhysicalMaterial({
    map: mmd.map,
    color: baseColor,
    emissive: mmd.emissive?.clone?.() ?? new THREE.Color(0x000000),
    emissiveMap: mmd.emissiveMap,
    emissiveIntensity: mmd.emissiveIntensity ?? 1,
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
    envMapIntensity: 1.1 * matcapHints.envBoost,
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
  m.envMapIntensity = THREE.MathUtils.lerp(base.envMapIntensity, 2.35, c);
  m.clearcoat = THREE.MathUtils.lerp(base.clearcoat, 0.58, c);
  m.clearcoatRoughness = THREE.MathUtils.lerp(base.clearcoatRoughness, 0.16, c);
  m.sheen = THREE.MathUtils.lerp(base.sheen, 0.42, c);
  m.sheenRoughness = THREE.MathUtils.lerp(base.sheenRoughness, 0.42, c);
  m.specularIntensity = THREE.MathUtils.lerp(base.specularIntensity, 1.35, c);
  m.ior = THREE.MathUtils.lerp(base.ior, 1.4, c);
  m.needsUpdate = true;
}

function promoteStandardToPhysical(mat: THREE.MeshStandardMaterial): THREE.MeshPhysicalMaterial {
  const phys = new THREE.MeshPhysicalMaterial();
  phys.copy(mat);
  if (!Number.isFinite(phys.attenuationDistance)) {
    phys.attenuationDistance = Infinity;
  }
  phys.userData[BASELINE_KEY] = snapshotPhysicalBaseline(phys);
  return phys;
}

function applyStrengthToMeshMaterials(mesh: THREE.Mesh, strength: number) {
  const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of list) {
    if (m instanceof THREE.MeshPhysicalMaterial) {
      ensurePhysicalBaseline(m);
      applyMeshPhysicalStrength(m, strength);
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
): void {
  if (!enabled) {
    root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) {
        return;
      }
      const backup = getStoredPhysicalBackup(obj);
      if (backup === undefined) {
        return;
      }

      const current = obj.material;
      obj.material = backup;
      deletePhysicalBackupKeys(obj);

      const backups = Array.isArray(backup) ? backup : [backup];
      const currents = Array.isArray(current) ? current : [current];

      currents.forEach((m) => {
        if (backups.includes(m)) {
          return;
        }
        if (m instanceof THREE.MeshPhysicalMaterial || m instanceof THREE.MeshStandardMaterial) {
          m.dispose();
        }
      });
    });
    return;
  }

  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) {
      return;
    }

    const hadBackup = getStoredPhysicalBackup(obj) !== undefined;

    if (!hadBackup) {
      const sourceList = Array.isArray(obj.material) ? [...obj.material] : [obj.material];
      const needsWork = sourceList.some(
        (m) => isMmdToonMaterial(m) || (m instanceof THREE.MeshStandardMaterial && !(m instanceof THREE.MeshPhysicalMaterial)),
      );

      if (needsWork) {
        delete obj.userData[LEGACY_CHARACTER_PHYSICAL_BACKUP_KEY];
        obj.userData[CHARACTER_MESH_PHYSICAL_BACKUP_KEY] = obj.material;
        const next = sourceList.map((m) => {
          if (isMmdToonMaterial(m)) {
            return mmdToonToPhysical(m);
          }
          if (m instanceof THREE.MeshStandardMaterial && !(m instanceof THREE.MeshPhysicalMaterial)) {
            return promoteStandardToPhysical(m);
          }
          if (m instanceof THREE.MeshPhysicalMaterial) {
            ensurePhysicalBaseline(m);
            return m;
          }
          return m;
        });
        obj.material = Array.isArray(obj.material) ? next : next[0]!;
      }
    }

    applyStrengthToMeshMaterials(obj, strength);
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
