import * as THREE from 'three';

const PAYLOAD_KEY = '__invertedHullPayload';
const IS_HULL_OUTLINE = '__isInvertedHullOutline';

type HullPayload = {
  outline: THREE.Mesh;
  uniforms: { uHullExpansion: THREE.IUniform };
};

function getPayload(source: THREE.Object3D): HullPayload | undefined {
  return source.userData[PAYLOAD_KEY] as HullPayload | undefined;
}

function needsNormals(geometry: THREE.BufferGeometry): boolean {
  return geometry.getAttribute('normal') === undefined;
}

function createHullMaterial(uniforms: { uHullExpansion: THREE.IUniform }): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    side: THREE.BackSide,
    depthTest: true,
    depthWrite: true,
    fog: false,
    toneMapped: false,
  });
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -1;
  mat.polygonOffsetUnits = -1;

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uHullExpansion = uniforms.uHullExpansion;
    // three.js does not auto-insert GLSL declarations for custom uniforms.
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
uniform float uHullExpansion;`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `
#if defined( USE_ENVMAP ) || defined( USE_SKINNING )
#else
  vec3 objectNormal = vec3( normal );
#endif
  transformed += normalize( objectNormal ) * uHullExpansion;
#include <project_vertex>
`,
    );
  };
  mat.customProgramCacheKey = () => 'invHullV2';

  return mat;
}

function copyAlphaFromSource(
  outlineMat: THREE.MeshBasicMaterial | THREE.MeshBasicMaterial[],
  sourceMat: THREE.Material | THREE.Material[],
) {
  const srcArr = Array.isArray(sourceMat) ? sourceMat : [sourceMat];
  const outArr = Array.isArray(outlineMat) ? outlineMat : [outlineMat];
  const n = Math.max(srcArr.length, outArr.length);
  for (let i = 0; i < n; i++) {
    const sm = srcArr[Math.min(i, srcArr.length - 1)];
    const om = outArr[Math.min(i, outArr.length - 1)];
    if (!sm || !om || !(sm instanceof THREE.Material)) continue;
    if ('alphaTest' in sm && sm.alphaTest > 0) {
      om.alphaTest = sm.alphaTest as number;
      om.transparent = sm.transparent === true;
    }
  }
}

function createOutlineMesh(
  source: THREE.Mesh,
  uniforms: { uHullExpansion: THREE.IUniform },
): THREE.Mesh {
  const srcMats = source.material;
  const mats = Array.isArray(srcMats)
    ? srcMats.map(() => createHullMaterial(uniforms))
    : createHullMaterial(uniforms);

  copyAlphaFromSource(mats as THREE.MeshBasicMaterial | THREE.MeshBasicMaterial[], srcMats);

  let outline: THREE.Mesh;
  if (source instanceof THREE.SkinnedMesh) {
    const s = source;
    outline = new THREE.SkinnedMesh(source.geometry, mats);
    const skOut = outline as THREE.SkinnedMesh;
    skOut.skeleton = s.skeleton;
    skOut.bindMode = s.bindMode;
    skOut.bindMatrix.copy(s.bindMatrix);
    skOut.bindMatrixInverse.copy(s.bindMatrixInverse);
  } else {
    outline = new THREE.Mesh(source.geometry, mats);
  }

  outline.frustumCulled = source.frustumCulled;
  outline.name = `${source.name || 'mesh'}__hullOutline`;
  outline.userData[IS_HULL_OUTLINE] = true;
  outline.castShadow = false;
  outline.receiveShadow = false;
  outline.renderOrder = source.renderOrder - 1;
  outline.layers.mask = source.layers.mask;

  if (source.morphTargetInfluences) {
    outline.morphTargetInfluences = source.morphTargetInfluences;
  }
  if (source.morphTargetDictionary) {
    outline.morphTargetDictionary = source.morphTargetDictionary;
  }

  return outline;
}

/**
 * Per-mesh inverted hull outlines: duplicate mesh with BackSide extrusion along normals
 * (object space after morph + skinning). Unlit black; optional alphaTest copied from source.
 */
export function syncInvertedHullOutlines(
  root: THREE.Object3D | null | undefined,
  enabled: boolean,
  hullExpansion: number,
): void {
  if (!root) {
    return;
  }

  if (!enabled) {
    // Outlines are tagged with IS_HULL_OUTLINE; sources only store PAYLOAD_KEY. The old path
    // only traversed "non-hull" meshes and never removed hull children — they stayed in the scene.
    const hullMeshes: THREE.Mesh[] = [];
    root.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.userData[IS_HULL_OUTLINE]) {
        hullMeshes.push(obj);
      }
    });
    for (const hull of hullMeshes) {
      hull.removeFromParent();
      const mats = hull.material;
      for (const m of Array.isArray(mats) ? mats : [mats]) {
        m.dispose();
      }
    }
    root.traverse((obj) => {
      if (obj instanceof THREE.Mesh && !obj.userData[IS_HULL_OUTLINE]) {
        delete obj.userData[PAYLOAD_KEY];
      }
    });
    return;
  }

  const thickness = Math.max(0, hullExpansion);

  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    if ((obj as THREE.InstancedMesh).isInstancedMesh) return;
    if (obj.userData[IS_HULL_OUTLINE]) return;

    const geom = obj.geometry;
    if (!geom || !geom.getAttribute('position')) return;
    if (needsNormals(geom)) {
      geom.computeVertexNormals();
    }

    let payload = getPayload(obj);
    if (!payload) {
      const uniforms = { uHullExpansion: { value: thickness } };
      const outline = createOutlineMesh(obj, uniforms);
      obj.userData[PAYLOAD_KEY] = { outline, uniforms };
      payload = obj.userData[PAYLOAD_KEY] as HullPayload;
      obj.parent?.add(outline);
    }
    payload.uniforms.uHullExpansion.value = thickness;
  });
}
