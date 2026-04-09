import * as THREE from 'three';

const PAYLOAD_KEY = '__invertedHullPayload';
const IS_HULL_OUTLINE = '__isInvertedHullOutline';
const NORMALS_TOUCHED_KEY = '__invertedHullNormalsComputed';
const HULL_THICKNESS_KEY = '__hullThicknessUniform';

type HullPayload = {
  outline: THREE.Mesh;
  sizeRef: number;
};

function getPayload(source: THREE.Object3D): HullPayload | undefined {
  return source.userData[PAYLOAD_KEY] as HullPayload | undefined;
}

function needsNormals(geometry: THREE.BufferGeometry): boolean {
  return geometry.getAttribute('normal') === undefined;
}

/**
 * Outline color — dark, slightly blue-tinted neutral that reads as a clean ink
 * line under both warm and cool lighting without competing with the character.
 */
const HULL_OUTLINE_COLOR = new THREE.Color(0x1a1a24);

function isGeometryOutlineable(geometry: THREE.BufferGeometry): boolean {
  const pos = geometry.getAttribute('position');
  if (!pos || pos.count < 3) return false;
  const arr = pos.array;
  if (!arr || arr.length === 0) return false;
  const sample = Math.min(arr.length, 30);
  for (let i = 0; i < sample; i++) {
    const v = arr[i] as number;
    if (!Number.isFinite(v)) return false;
  }
  return true;
}

function isSkinnedMeshRenderable(mesh: THREE.SkinnedMesh): boolean {
  return mesh.skeleton != null;
}

const _geomSizeScratch = new THREE.Vector3();

function measureMeshSizeRef(mesh: THREE.Mesh): number {
  const g = mesh.geometry as THREE.BufferGeometry | undefined;
  if (!g) return 1;
  if (!g.boundingBox) {
    g.computeBoundingBox();
  }
  const bb = g.boundingBox;
  if (!bb || bb.isEmpty()) {
    return 1;
  }
  bb.getSize(_geomSizeScratch);
  const ref = Math.max(_geomSizeScratch.x, _geomSizeScratch.y, _geomSizeScratch.z);
  return Number.isFinite(ref) && ref > 1e-6 ? ref : 1;
}

/**
 * Proper inverted hull material: extrudes vertices along their normals in the
 * vertex shader via onBeforeCompile.  For SkinnedMesh the extrusion runs
 * *after* skinning so outlines follow pose deformation correctly.
 *
 * The `hullThickness` uniform is stored in userData so we can update it without
 * rebuilding the material.
 */
function createHullMaterial(thickness: number): THREE.MeshBasicMaterial {
  const thicknessUniform = { value: thickness };

  const mat = new THREE.MeshBasicMaterial({
    color: HULL_OUTLINE_COLOR,
    side: THREE.BackSide,
    depthTest: true,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
    transparent: true,
    opacity: 1,
  });

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.hullThickness = thicknessUniform;

    // Inject the uniform declaration at the very top of the vertex shader.
    shader.vertexShader = 'uniform float hullThickness;\n' + shader.vertexShader;

    // Extrude along the *transformed* normal after skinning + model-view so
    // the outline follows the posed mesh.  We push in clip-space-scaled
    // view-space so thickness is roughly screen-constant regardless of depth.
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      /* glsl */ `
        #include <project_vertex>
        #ifdef USE_SKINNING
          vec3 hullNormal = normalize( mat3(modelViewMatrix) * objectNormal );
        #else
          vec3 hullNormal = normalize( normalMatrix * objectNormal );
        #endif
        // Push along normal in view-space, then scale by w so thickness is
        // near-constant in screen pixels regardless of camera distance.
        mvPosition.xyz += hullNormal * hullThickness * mvPosition.w;
        gl_Position = projectionMatrix * mvPosition;
      `,
    );

    // Ensure alphaMap and alphaTest are respected in the fragment shader.
    // This is critical for hair cards, eyelashes, and other cutout meshes.
    if (shader.fragmentShader.indexOf('USE_ALPHAMAP') === -1) {
      shader.fragmentShader = shader.fragmentShader.replace(
        'void main() {',
        `#ifdef USE_ALPHAMAP
          vec4 texColor = texture2D(alphaMap, vUv);
          float alpha = texColor.r;
          #ifdef USE_ALPHATEST
            if (alpha < alphaTest) discard;
          #endif
        #endif
        void main() {`
      );
    }
  };

  mat.userData[HULL_THICKNESS_KEY] = thicknessUniform;
  return mat;
}

function setHullThickness(mat: THREE.Material, thickness: number) {
  const u = mat.userData[HULL_THICKNESS_KEY] as { value: number } | undefined;
  if (u) {
    u.value = thickness;
  }
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
    
    // Copy alphaMap for cutout meshes (hair cards, eyelashes, etc.)
    if ('alphaMap' in sm && sm.alphaMap) {
      om.alphaMap = sm.alphaMap as THREE.Texture;
      if (om.alphaMap) {
        om.alphaMap.needsUpdate = true;
      }
    }
    // Copy alphaTest for alpha-cutout materials
    if ('alphaTest' in sm && sm.alphaTest !== undefined) {
      om.alphaTest = sm.alphaTest as number;
    }
    // Copy transparent flag
    if ('transparent' in sm) {
      om.transparent = sm.transparent === true;
    }
    // Copy opacity for general transparency
    if ('opacity' in sm) {
      om.opacity = sm.opacity as number;
    }
  }
}

function syncOutlineSiblingTransform(
  source: THREE.Mesh,
  outline: THREE.Mesh,
): void {
  if (outline.parent !== source.parent && source.parent) {
    outline.removeFromParent();
    source.parent.add(outline);
  }
  outline.position.copy(source.position);
  outline.quaternion.copy(source.quaternion);
  outline.scale.copy(source.scale);
}

function createOutlineMesh(source: THREE.Mesh, thickness: number): THREE.Mesh {
  const srcMats = source.material;
  const mats = Array.isArray(srcMats)
    ? srcMats.map(() => createHullMaterial(thickness))
    : createHullMaterial(thickness);

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

  outline.frustumCulled = false;
  outline.name = `${source.name || 'mesh'}__hullOutline`;
  outline.userData[IS_HULL_OUTLINE] = true;
  outline.castShadow = false;
  outline.receiveShadow = false;
  outline.renderOrder = Math.max(-100000, Math.min(100000, source.renderOrder - 1));
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
 * Inverted-hull–style outline: duplicate mesh, BackSide material, vertices
 * extruded along normals in the vertex shader (onBeforeCompile).
 *
 * Extrusion happens in view-space *after* skinning, so outlines track posed
 * deformation correctly. Thickness is perspective-compensated (× clip w) to
 * stay visually constant on screen.
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

  const base = Number.isFinite(hullExpansion) ? Math.max(0, hullExpansion) : 0;

  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    if ((obj as THREE.InstancedMesh).isInstancedMesh) return;
    if ((obj as THREE.Mesh & { isBatchedMesh?: boolean }).isBatchedMesh) return;
    if (obj.userData[IS_HULL_OUTLINE]) return;

    const geom = obj.geometry;
    if (!geom || !isGeometryOutlineable(geom)) return;

    if (obj instanceof THREE.SkinnedMesh && !isSkinnedMeshRenderable(obj)) {
      return;
    }

    if (needsNormals(geom)) {
      if (!geom.userData[NORMALS_TOUCHED_KEY]) {
        geom.computeVertexNormals();
        geom.userData[NORMALS_TOUCHED_KEY] = true;
      }
    }

    let sizeRef: number;
    let payload = getPayload(obj);

    if (!payload) {
      sizeRef = measureMeshSizeRef(obj);
      // Convert UI range [0.002, 0.025] to a clip-space thickness.
      // Dividing by sizeRef normalises across differently-scaled models.
      const thickness = THREE.MathUtils.clamp(base / Math.max(sizeRef, 0.01) * 0.35, 0.0005, 0.025);
      const outline = createOutlineMesh(obj, thickness);
      obj.userData[PAYLOAD_KEY] = { outline, sizeRef };
      payload = obj.userData[PAYLOAD_KEY] as HullPayload;
      if (obj.parent) {
        obj.parent.add(outline);
      } else {
        obj.add(outline);
      }
    }

    sizeRef = payload.sizeRef;
    if (!(sizeRef > 0)) {
      sizeRef = measureMeshSizeRef(obj);
      payload.sizeRef = sizeRef;
    }

    const thickness = THREE.MathUtils.clamp(base / Math.max(sizeRef, 0.01) * 0.35, 0.0005, 0.025);

    // Update the thickness uniform on all hull materials.
    const outMats = payload.outline.material;
    for (const m of Array.isArray(outMats) ? outMats : [outMats]) {
      setHullThickness(m, thickness);
    }

    // Re-sync alpha properties from source in case material changed (e.g., PMX reload)
    // This fixes instability where reloading requires multiple attempts.
    copyAlphaFromSource(
      (Array.isArray(outMats) ? outMats : [outMats]) as THREE.MeshBasicMaterial[],
      obj.material,
    );

    syncOutlineSiblingTransform(obj, payload.outline);
  });
}
