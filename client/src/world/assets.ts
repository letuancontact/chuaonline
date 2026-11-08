import { LoadingManager, RepeatWrapping, SRGBColorSpace, TextureLoader, type Texture } from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

export const ASSET_BASE = `${import.meta.env.BASE_URL}assets/`;

export class AssetLoadError extends Error {
  constructor(readonly url: string, cause?: unknown) {
    super(`asset failed to load: ${url}`, { cause });
    this.name = "AssetLoadError";
  }
}

export interface TextureOptions {
  /** Colour textures are sRGB; data maps (normal, roughness) stay linear. */
  srgb?: boolean;
  repeat?: number;
}

/**
 * Loads models/textures under /assets with a shared cache and progress callback.
 * Any failure rejects with AssetLoadError so the boot screen can show the load error (P-D8, AC2).
 */
export class Assets {
  private readonly manager: LoadingManager;
  private readonly gltf: GLTFLoader;
  private readonly textures: TextureLoader;
  private readonly textureCache = new Map<string, Promise<Texture>>();
  private readonly owned = new Set<Texture>();

  constructor(onProgress?: (loaded: number, total: number) => void) {
    this.manager = new LoadingManager();
    if (onProgress) this.manager.onProgress = (_url, loaded, total) => onProgress(loaded, total);
    this.gltf = new GLTFLoader(this.manager).setMeshoptDecoder(MeshoptDecoder);
    this.textures = new TextureLoader(this.manager);
  }

  async model(path: string): Promise<GLTF> {
    const url = ASSET_BASE + path;
    try {
      return await this.gltf.loadAsync(url);
    } catch (err) {
      throw new AssetLoadError(url, err);
    }
  }

  /** Same path + options → same Texture instance. */
  texture(path: string, opts: TextureOptions = {}): Promise<Texture> {
    const url = ASSET_BASE + path;
    const key = `${url}|${opts.srgb ? 1 : 0}|${opts.repeat ?? 1}`;
    let pending = this.textureCache.get(key);
    if (!pending) {
      pending = this.textures.loadAsync(url).then(
        (tex) => {
          if (opts.srgb) tex.colorSpace = SRGBColorSpace;
          if (opts.repeat !== undefined) {
            tex.wrapS = tex.wrapT = RepeatWrapping;
            tex.repeat.set(opts.repeat, opts.repeat);
          }
          this.owned.add(tex);
          return tex;
        },
        (err: unknown) => {
          this.textureCache.delete(key);
          throw new AssetLoadError(url, err);
        },
      );
      this.textureCache.set(key, pending);
    }
    return pending;
  }

  dispose(): void {
    for (const tex of this.owned) tex.dispose();
    this.owned.clear();
    this.textureCache.clear();
  }
}
