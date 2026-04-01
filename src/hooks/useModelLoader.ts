import { useRef, useCallback } from 'react';
import * as THREE from 'three';
import { MMDLoader } from '@three-mmd/loaders/MMDLoader.js';
import { MMDAnimationHelper } from '@three-mmd/animation/MMDAnimationHelper.js';
import { OBJLoader } from '@three-jsm/loaders/OBJLoader.js';
import { MTLLoader } from '@three-jsm/loaders/MTLLoader.js';
import { FBXLoader } from '@three-jsm/loaders/FBXLoader.js';
import { GLTFLoader } from '@three-jsm/loaders/GLTFLoader.js';
import { ColladaLoader } from '@three-jsm/loaders/ColladaLoader.js';
import { STLLoader } from '@three-jsm/loaders/STLLoader.js';
import { PLYLoader } from '@three-jsm/loaders/PLYLoader.js';
import { VRMLLoader } from '@three-jsm/loaders/VRMLLoader.js';

export interface Character {
  id: number;
  type?: 'character' | 'stage';
  modelFile: File | null;
  texFiles: File[];
  vmdFiles: File[];
  mesh: THREE.Object3D | null;
  mmdMesh: THREE.SkinnedMesh | null;
  mmdHelper: MMDAnimationHelper | null;
  vmdClip: THREE.AnimationClip | null;
  mixer: THREE.AnimationMixer | null;
  action: THREE.AnimationAction | null;
  durationFrames: number;
  physicsEnabled: boolean;
  group: THREE.Group;
  tx: { x: number; y: number; z: number; rx: number; ry: number; rz: number; s: number };
  outlines: THREE.Object3D[];
  loaded: boolean;
  parent: string | null;
}

export interface LoadedModel {
  id: string;
  name: string;
  mesh: THREE.Object3D;
  type: 'mmd' | 'vrm' | 'fbx' | 'obj' | 'gltf' | 'dae' | 'stl' | 'ply' | 'wrl';
  animations?: THREE.AnimationClip[];
  vmdFiles?: File[];
}

export const useModelLoader = () => {
  const loadingManagerRef = useRef<THREE.LoadingManager | null>(null);
  const mmdHelperRef = useRef<MMDAnimationHelper | null>(null);

  // Initialize loaders
  const getLoadingManager = useCallback(() => {
    if (!loadingManagerRef.current) {
      loadingManagerRef.current = new THREE.LoadingManager();
      loadingManagerRef.current.setURLModifier((url) => {
        // Handle data URIs and file:// protocols
        if (url.startsWith('data:') || url.startsWith('blob:')) {
          return url;
        }
        return url;
      });
    }
    return loadingManagerRef.current;
  }, []);

  const getMMDHelper = useCallback(() => {
    if (!mmdHelperRef.current) {
      mmdHelperRef.current = new MMDAnimationHelper();
    }
    return mmdHelperRef.current;
  }, []);

  // Load MMD PMX/PMD model
  const loadMMDModel = useCallback(async (file: File, vmdFiles?: File[]): Promise<LoadedModel> => {
    return new Promise((resolve, reject) => {
      const loader = new MMDLoader(getLoadingManager());
      const helper = getMMDHelper();
      
      const objectURL = URL.createObjectURL(file);
      
      loader.load(
        objectURL,
        (mesh) => {
          // Add to helper if there are VMD files
          if (vmdFiles && vmdFiles.length > 0) {
            vmdFiles.forEach((vmdFile, index) => {
              const vmdURL = URL.createObjectURL(vmdFile);
              loader.loadAnimation(vmdURL, mesh, (animation) => {
                helper.add(mesh, animation as any);
                URL.revokeObjectURL(vmdURL);
              }, undefined, (error) => {
                console.error(`Error loading VMD file ${index}:`, error);
                URL.revokeObjectURL(vmdURL);
              });
            });
          }
          
          URL.revokeObjectURL(objectURL);
          
          const model: LoadedModel = {
            id: `mmd_${Date.now()}`,
            name: file.name,
            mesh,
            type: 'mmd',
            vmdFiles
          };
          
          resolve(model);
        },
        (progress) => {
          console.log('Loading progress:', (progress.loaded / progress.total) * 100 + '%');
        },
        (error) => {
          URL.revokeObjectURL(objectURL);
          reject(error);
        }
      );
    });
  }, [getLoadingManager, getMMDHelper]);

  // Load FBX model
  const loadFBXModel = useCallback(async (file: File): Promise<LoadedModel> => {
    return new Promise((resolve, reject) => {
      const loader = new FBXLoader(getLoadingManager());
      const objectURL = URL.createObjectURL(file);
      
      loader.load(
        objectURL,
        (object) => {
          URL.revokeObjectURL(objectURL);
          
          const model: LoadedModel = {
            id: `fbx_${Date.now()}`,
            name: file.name,
            mesh: object,
            type: 'fbx',
            animations: object.animations
          };
          
          resolve(model);
        },
        (progress) => {
          console.log('Loading progress:', (progress.loaded / progress.total) * 100 + '%');
        },
        (error) => {
          URL.revokeObjectURL(objectURL);
          reject(error);
        }
      );
    });
  }, [getLoadingManager]);

  // Load GLTF/GLB model
  const loadGLTFModel = useCallback(async (file: File): Promise<LoadedModel> => {
    return new Promise((resolve, reject) => {
      const loader = new GLTFLoader(getLoadingManager());
      const objectURL = URL.createObjectURL(file);
      
      loader.load(
        objectURL,
        (gltf) => {
          URL.revokeObjectURL(objectURL);
          
          const model: LoadedModel = {
            id: `gltf_${Date.now()}`,
            name: file.name,
            mesh: gltf.scene,
            type: 'gltf',
            animations: gltf.animations
          };
          
          resolve(model);
        },
        (progress) => {
          console.log('Loading progress:', (progress.loaded / progress.total) * 100 + '%');
        },
        (error) => {
          URL.revokeObjectURL(objectURL);
          reject(error);
        }
      );
    });
  }, [getLoadingManager]);

  // Load OBJ model
  const loadOBJModel = useCallback(async (file: File, mtlFile?: File): Promise<LoadedModel> => {
    return new Promise((resolve, reject) => {
      const objectURL = URL.createObjectURL(file);
      
      if (mtlFile) {
        const mtlLoader = new MTLLoader(getLoadingManager());
        const mtlURL = URL.createObjectURL(mtlFile);
        
        mtlLoader.load(mtlURL, (materials) => {
          materials.preload();
          const objLoader = new OBJLoader(getLoadingManager());
          objLoader.setMaterials(materials);
          
          objLoader.load(objectURL, (object) => {
            URL.revokeObjectURL(objectURL);
            URL.revokeObjectURL(mtlURL);
            
            const model: LoadedModel = {
              id: `obj_${Date.now()}`,
              name: file.name,
              mesh: object,
              type: 'obj'
            };
            
            resolve(model);
          }, undefined, (error) => {
            URL.revokeObjectURL(objectURL);
            URL.revokeObjectURL(mtlURL);
            reject(error);
          });
        }, undefined, (error) => {
          URL.revokeObjectURL(mtlURL);
          URL.revokeObjectURL(objectURL);
          reject(error);
        });
      } else {
        const objLoader = new OBJLoader(getLoadingManager());
        objLoader.load(objectURL, (object) => {
          URL.revokeObjectURL(objectURL);
          
          const model: LoadedModel = {
            id: `obj_${Date.now()}`,
            name: file.name,
            mesh: object,
            type: 'obj'
          };
          
          resolve(model);
        }, undefined, (error) => {
          URL.revokeObjectURL(objectURL);
          reject(error);
        });
      }
    });
  }, [getLoadingManager]);

  // Universal model loader based on file extension
  const loadModel = useCallback(async (file: File, additionalFiles?: File[]): Promise<LoadedModel> => {
    const extension = file.name.split('.').pop()?.toLowerCase();
    
    switch (extension) {
      case 'pmx':
      case 'pmd':
        return loadMMDModel(file, additionalFiles);
      
      case 'fbx':
        return loadFBXModel(file);
      
      case 'gltf':
      case 'glb':
        return loadGLTFModel(file);
      
      case 'obj':
        const mtlFile = additionalFiles?.find(f => f.name.endsWith('.mtl'));
        return loadOBJModel(file, mtlFile);
      
      case 'dae':
        return new Promise((resolve, reject) => {
          const loader = new ColladaLoader(getLoadingManager());
          const objectURL = URL.createObjectURL(file);
          
          loader.load(objectURL, (collada) => {
            URL.revokeObjectURL(objectURL);
            
            const model: LoadedModel = {
              id: `dae_${Date.now()}`,
              name: file.name,
              mesh: collada.scene,
              type: 'dae',
              animations: collada.scene.animations || []
            };
            
            resolve(model);
          }, undefined, (error) => {
            URL.revokeObjectURL(objectURL);
            reject(error);
          });
        });
      
      case 'stl':
        return new Promise((resolve, reject) => {
          const loader = new STLLoader(getLoadingManager());
          const objectURL = URL.createObjectURL(file);
          
          loader.load(objectURL, (geometry) => {
            URL.revokeObjectURL(objectURL);
            
            const material = new THREE.MeshStandardMaterial();
            const mesh = new THREE.Mesh(geometry, material);
            
            const model: LoadedModel = {
              id: `stl_${Date.now()}`,
              name: file.name,
              mesh,
              type: 'stl'
            };
            
            resolve(model);
          }, undefined, (error) => {
            URL.revokeObjectURL(objectURL);
            reject(error);
          });
        });
      
      case 'ply':
        return new Promise((resolve, reject) => {
          const loader = new PLYLoader(getLoadingManager());
          const objectURL = URL.createObjectURL(file);
          
          loader.load(objectURL, (geometry) => {
            URL.revokeObjectURL(objectURL);
            
            const material = new THREE.MeshStandardMaterial();
            const mesh = new THREE.Mesh(geometry, material);
            
            const model: LoadedModel = {
              id: `ply_${Date.now()}`,
              name: file.name,
              mesh,
              type: 'ply'
            };
            
            resolve(model);
          }, undefined, (error) => {
            URL.revokeObjectURL(objectURL);
            reject(error);
          });
        });
      
      case 'wrl':
      case 'vrml':
        return new Promise((resolve, reject) => {
          const loader = new VRMLLoader(getLoadingManager());
          const objectURL = URL.createObjectURL(file);
          
          loader.load(objectURL, (scene) => {
            URL.revokeObjectURL(objectURL);
            
            const model: LoadedModel = {
              id: `wrl_${Date.now()}`,
              name: file.name,
              mesh: scene,
              type: 'wrl'
            };
            
            resolve(model);
          }, undefined, (error) => {
            URL.revokeObjectURL(objectURL);
            reject(error);
          });
        });
      
      default:
        throw new Error(`Unsupported file format: ${extension}`);
    }
  }, [loadMMDModel, loadFBXModel, loadGLTFModel, loadOBJModel, getLoadingManager]);

  return {
    loadModel,
    loadMMDModel,
    loadFBXModel,
    loadGLTFModel,
    loadOBJModel,
    getMMDHelper
  };
};
