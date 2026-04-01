declare module '@three-jsm/libs/ammo.wasm.js' {
  interface AmmoFactoryOptions {
    locateFile?: (path: string, prefix?: string) => string;
  }

  /** Emscripten factory: call with options, returns a Promise that resolves to the Ammo API. */
  const Ammo: (options?: AmmoFactoryOptions) => Promise<unknown>;
  export default typeof Ammo;
}
