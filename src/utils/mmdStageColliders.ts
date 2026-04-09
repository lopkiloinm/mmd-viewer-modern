import * as THREE from 'three';
import type { Character } from '../hooks/useModelLoader';

/** Group bit 0; MMD rigid bodies collide if their PMX `groupTarget` includes this bit (0xffff is common). */
const STAGE_COLLISION_GROUP = 1;
const STAGE_COLLISION_MASK = 0xffff;

const MIN_HALF_EXTENT = 0.02;
/** Matches ThreeScene default `PlaneGeometry(200, 200)` floor. */
const DEFAULT_FLOOR_HALF_XZ = 100;
const DEFAULT_FLOOR_HALF_Y = 0.25;

export interface MmdPhysicsWorldLike {
  world: {
    addRigidBody(body: unknown, group: number, mask: number): void;
    removeRigidBody(body: unknown): void;
  };
}

type AmmoBt = {
  btBoxShape: new (half: unknown) => { setLocalScaling?: (v: unknown) => void };
  btVector3: new (x: number, y: number, z: number) => unknown;
  btQuaternion: new (x: number, y: number, z: number, w: number) => unknown;
  btTransform: new () => {
    setIdentity(): void;
    setOrigin(v: unknown): void;
    setRotation(q: unknown): void;
  };
  btDefaultMotionState: new (t: unknown) => unknown;
  btRigidBodyConstructionInfo: new (mass: number, motionState: unknown, shape: unknown, inertia: unknown) => {
    set_m_friction(v: number): void;
    set_m_restitution(v: number): void;
  };
  btRigidBody: new (info: unknown) => {
    getCollisionFlags(): number;
    setCollisionFlags(v: number): void;
    setActivationState(v: number): void;
    setCenterOfMassTransform(t: unknown): void;
    getMotionState(): { setWorldTransform(t: unknown): void };
  };
};

function getAmmo(): AmmoBt | null {
  const scope = globalThis as typeof globalThis & { Ammo?: AmmoBt };
  return scope.Ammo ?? null;
}

type ColliderEntry = {
  body: unknown;
  shape: { setLocalScaling?: (v: unknown) => void };
  motionState: unknown;
  constructionInfo: unknown;
  sourceObject: THREE.Mesh | null;
};

type StageData = {
  structureKey: string;
  entries: ColliderEntry[];
  tempBox: THREE.Box3;
  tempCenter: THREE.Vector3;
  tempSize: THREE.Vector3;
};

function getStagePhysicsStore(physics: object): StageData | undefined {
  return (physics as { __nmsStagePhysics?: StageData }).__nmsStagePhysics;
}

function destroyAmmoObject(obj: unknown): void {
  if (!obj || typeof obj !== 'object') return;
  const anyObj = obj as { destroy?: () => void; __destroy___?: () => void };
  if (typeof anyObj.destroy === 'function') anyObj.destroy.call(obj);
  else if (typeof anyObj.__destroy___ === 'function') anyObj.__destroy___.call(obj);
}

export function clearMmdStageColliders(physics: MmdPhysicsWorldLike | null | undefined): void {
  if (!physics) return;
  const store = getStagePhysicsStore(physics as object);
  if (!store) return;

  const Ammo = getAmmo();
  const world = physics.world;

  for (const entry of store.entries) {
    try {
      world.removeRigidBody(entry.body);
    } catch {
      /* */
    }
    if (Ammo) {
      destroyAmmoObject(entry.body);
      destroyAmmoObject(entry.constructionInfo);
      destroyAmmoObject(entry.motionState);
      destroyAmmoObject(entry.shape);
    }
  }

  delete (physics as { __nmsStagePhysics?: StageData }).__nmsStagePhysics;
}

function computeStageStructureKey(characters: Character[], defaultStageVisible: boolean): string {
  const stages = characters.filter((c) => c.type === 'stage');
  const head = defaultStageVisible ? 'f1' : 'f0';
  const stageParts = stages.map((s) => {
    let meshCount = 0;
    if (s.loaded && s.mesh) {
      s.mesh.traverse((ch) => {
        if ((ch as THREE.Mesh).isMesh) meshCount += 1;
      });
    }
    return `${s.id}:${s.loaded ? 1 : 0}:${s.mesh?.uuid ?? '-'}:${meshCount}`;
  });
  return [head, ...stageParts].join('|');
}

/** Unit half-extents (1,1,1); real size applied via `setLocalScaling` so AABB can change each step without recreating the body. */
function addStaticUnitBox(
  world: MmdPhysicsWorldLike['world'],
  center: THREE.Vector3,
  halfExtents: THREE.Vector3,
): ColliderEntry | null {
  const Ammo = getAmmo();
  if (!Ammo) return null;

  const hx = Math.max(halfExtents.x, MIN_HALF_EXTENT);
  const hy = Math.max(halfExtents.y, MIN_HALF_EXTENT);
  const hz = Math.max(halfExtents.z, MIN_HALF_EXTENT);

  const shape = new Ammo.btBoxShape(new Ammo.btVector3(1, 1, 1));
  if (typeof shape.setLocalScaling === 'function') {
    shape.setLocalScaling(new Ammo.btVector3(hx, hy, hz));
  }

  const transform = new Ammo.btTransform();
  transform.setIdentity();
  transform.setOrigin(new Ammo.btVector3(center.x, center.y, center.z));
  transform.setRotation(new Ammo.btQuaternion(0, 0, 0, 1));

  const motionState = new Ammo.btDefaultMotionState(transform);
  const localInertia = new Ammo.btVector3(0, 0, 0);
  const constructionInfo = new Ammo.btRigidBodyConstructionInfo(0, motionState, shape, localInertia);
  constructionInfo.set_m_friction(0.85);
  constructionInfo.set_m_restitution(0.02);

  const body = new Ammo.btRigidBody(constructionInfo);
  body.setCollisionFlags(body.getCollisionFlags() | 2);
  body.setActivationState(4);

  world.addRigidBody(body, STAGE_COLLISION_GROUP, STAGE_COLLISION_MASK);

  destroyAmmoObject(localInertia);
  destroyAmmoObject(transform);

  return {
    body,
    shape,
    motionState,
    constructionInfo,
    sourceObject: null,
  };
}

function buildDefaultFloor(world: MmdPhysicsWorldLike['world'], entries: ColliderEntry[]): void {
  const center = new THREE.Vector3(0, -DEFAULT_FLOOR_HALF_Y, 0);
  const half = new THREE.Vector3(DEFAULT_FLOOR_HALF_XZ, DEFAULT_FLOOR_HALF_Y, DEFAULT_FLOOR_HALF_XZ);
  const box = addStaticUnitBox(world, center, half);
  if (box) entries.push(box);
}

function buildStageMeshColliders(
  world: MmdPhysicsWorldLike['world'],
  stageRoot: THREE.Object3D,
  entries: ColliderEntry[],
  tempBox: THREE.Box3,
): void {
  stageRoot.updateMatrixWorld(true);
  stageRoot.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;

    tempBox.setFromObject(mesh);
    if (tempBox.isEmpty()) return;

    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    tempBox.getSize(size);
    tempBox.getCenter(center);

    const halfExtents = size.multiplyScalar(0.5);
    const box = addStaticUnitBox(world, center, halfExtents);
    if (box) {
      box.sourceObject = mesh;
      entries.push(box);
    }
  });
}

function rebuildStageColliders(
  physics: MmdPhysicsWorldLike,
  characters: Character[],
  defaultStageVisible: boolean,
): void {
  clearMmdStageColliders(physics);

  const entries: ColliderEntry[] = [];
  const tempBox = new THREE.Box3();

  if (defaultStageVisible) {
    buildDefaultFloor(physics.world, entries);
  }

  const stages = characters.filter((c) => c.type === 'stage' && c.loaded && c.mesh);
  for (const st of stages) {
    st.group.updateMatrixWorld(true);
    buildStageMeshColliders(physics.world, st.group, entries, tempBox);
  }

  const structureKey = computeStageStructureKey(characters, defaultStageVisible);
  (physics as { __nmsStagePhysics?: StageData }).__nmsStagePhysics = {
    structureKey,
    entries,
    tempBox: new THREE.Box3(),
    tempCenter: new THREE.Vector3(),
    tempSize: new THREE.Vector3(),
  };
}

function syncMeshEntry(entry: ColliderEntry, store: StageData, Ammo: AmmoBt): void {
  if (!entry.sourceObject) return;

  const mesh = entry.sourceObject;
  mesh.updateWorldMatrix(true, false);

  const { tempBox, tempCenter, tempSize } = store;
  tempBox.setFromObject(mesh);
  if (tempBox.isEmpty()) return;

  tempBox.getCenter(tempCenter);
  tempBox.getSize(tempSize);
  const hx = Math.max(tempSize.x * 0.5, MIN_HALF_EXTENT);
  const hy = Math.max(tempSize.y * 0.5, MIN_HALF_EXTENT);
  const hz = Math.max(tempSize.z * 0.5, MIN_HALF_EXTENT);

  if (typeof entry.shape.setLocalScaling === 'function') {
    entry.shape.setLocalScaling(new Ammo.btVector3(hx, hy, hz));
  }

  const transform = new Ammo.btTransform();
  transform.setIdentity();
  transform.setOrigin(new Ammo.btVector3(tempCenter.x, tempCenter.y, tempCenter.z));
  transform.setRotation(new Ammo.btQuaternion(0, 0, 0, 1));

  const body = entry.body as InstanceType<AmmoBt['btRigidBody']>;
  body.getMotionState().setWorldTransform(transform);
  body.setCenterOfMassTransform(transform);

  destroyAmmoObject(transform);
}

/**
 * Ensures static floor + stage mesh AABBs exist in this character's dynamics world; syncs transforms/sizes each frame.
 * Intended for `MMDAnimationHelper.onBeforePhysics` (after IK/animation, before `physics.update`).
 */
export function refreshMmdStageCollidersForPhysics(
  physics: MmdPhysicsWorldLike | null | undefined,
  characters: Character[],
  defaultStageVisible: boolean,
): void {
  if (!physics?.world) return;
  const Ammo = getAmmo();
  if (!Ammo) return;

  const targetKey = computeStageStructureKey(characters, defaultStageVisible);
  let store = getStagePhysicsStore(physics as object);

  if (!store || store.structureKey !== targetKey) {
    rebuildStageColliders(physics, characters, defaultStageVisible);
    store = getStagePhysicsStore(physics as object);
  }

  if (!store) return;

  for (const entry of store.entries) {
    if (entry.sourceObject) {
      syncMeshEntry(entry, store, Ammo);
    }
  }
}

export type MmdAnimationHelperLike = {
  objects: WeakMap<THREE.SkinnedMesh, { physics?: MmdPhysicsWorldLike }>;
  onBeforePhysics: (mesh: THREE.SkinnedMesh) => void;
};

/**
 * Per-frame hook: keeps environment colliders aligned with scene graphs without altering IK/physics order.
 */
export function installMmdStageEnvironmentBridge(
  helper: MmdAnimationHelperLike,
  getContext: () => { characters: Character[]; defaultStageVisible: boolean },
): void {
  const previous = helper.onBeforePhysics;
  helper.onBeforePhysics = function onBeforePhysicsWithStage(mesh: THREE.SkinnedMesh) {
    previous(mesh);
    const physics = helper.objects.get(mesh)?.physics;
    const { characters, defaultStageVisible } = getContext();
    refreshMmdStageCollidersForPhysics(physics, characters, defaultStageVisible);
  };
}
