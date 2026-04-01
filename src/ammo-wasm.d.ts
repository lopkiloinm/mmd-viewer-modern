declare module 'three/examples/jsm/libs/ammo.wasm.js' {
  interface AmmoModuleOptions {
    locateFile?: (path: string) => string;
  }

  const AmmoModule: (options?: AmmoModuleOptions) => Promise<unknown>;

  export default AmmoModule;
}
