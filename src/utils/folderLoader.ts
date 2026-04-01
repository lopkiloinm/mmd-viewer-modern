import JSZip from 'jszip';

export interface ModelFolderContents {
  pmxFile: File | null;
  textureFiles: File[];
  allFiles: File[];
}

export interface DiscoveredModel {
  pmxFile: File;
  textureFiles: File[];
  name: string;
}

/**
 * Scans a FileList (from folder selection) and discovers PMX/PMD models and textures
 */
export function discoverModelsFromFolder(files: FileList | File[]): DiscoveredModel[] {
  const fileArray = Array.from(files);
  
  // Find all PMX/PMD files
  const modelFiles = fileArray.filter(f => 
    f.name.toLowerCase().endsWith('.pmx') || 
    f.name.toLowerCase().endsWith('.pmd')
  );
  
  // Find all texture files (common image formats)
  const textureFiles = fileArray.filter(f => {
    const ext = f.name.toLowerCase().split('.').pop();
    return ext && ['png', 'jpg', 'jpeg', 'bmp', 'tga', 'gif', 'tif', 'tiff', 'sph', 'spa'].includes(ext);
  });
  
  if (modelFiles.length === 0) {
    return [];
  }
  
  // For each model file, find associated textures
  return modelFiles.map(pmxFile => {
    const modelDir = getDirectoryPath(pmxFile);
    
    // Look for textures in common locations relative to the PMX
    const associatedTextures = textureFiles.filter(tex => {
      const texDir = getDirectoryPath(tex);
      
      // Texture is in same directory as model
      if (texDir === modelDir) return true;
      
      // Texture is in tex/ or texture/ subdirectory of model's directory
      const relativePath = getRelativePath(modelDir, texDir);
      if (relativePath === 'tex' || relativePath === 'texture') return true;
      
      // Texture is referenced by relative path from model
      if (texDir.startsWith(modelDir)) return true;
      
      return false;
    });
    
    return {
      pmxFile,
      textureFiles: associatedTextures,
      name: pmxFile.name.replace(/\.(pmx|pmd)$/i, '')
    };
  });
}

/**
 * Extracts and discovers models from a ZIP file
 */
export async function extractAndDiscoverFromZip(zipFile: File): Promise<DiscoveredModel[]> {
  const zip = await JSZip.loadAsync(zipFile);
  const files: File[] = [];
  
  // Extract all files from ZIP
  const promises: Promise<void>[] = [];
  
  zip.forEach((relativePath, zipEntry) => {
    if (!zipEntry.dir) {
      const promise = zipEntry.async('blob').then(blob => {
        const file = new File([blob], zipEntry.name, { 
          type: getMimeType(zipEntry.name) 
        });
        // Preserve the relative path info for texture resolution
        Object.defineProperty(file, 'webkitRelativePath', {
          value: relativePath,
          writable: false
        });
        files.push(file);
      });
      promises.push(promise);
    }
  });
  
  await Promise.all(promises);
  
  // Use same discovery logic
  return discoverModelsFromFolder(files);
}

/**
 * Gets the directory path from a file's relative path
 */
function getDirectoryPath(file: File): string {
  const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
  const lastSlash = path.lastIndexOf('/');
  return lastSlash > 0 ? path.substring(0, lastSlash) : '';
}

/**
 * Gets the relative path from base to target
 */
function getRelativePath(baseDir: string, targetDir: string): string | null {
  if (!targetDir.startsWith(baseDir)) return null;
  const relative = targetDir.substring(baseDir.length).replace(/^\//, '');
  // Return first component only
  const slashIndex = relative.indexOf('/');
  return slashIndex > 0 ? relative.substring(0, slashIndex) : relative;
}

/**
 * Determines MIME type based on file extension
 */
function getMimeType(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop();
  const mimeTypes: Record<string, string> = {
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'bmp': 'image/bmp',
    'gif': 'image/gif',
    'tga': 'image/x-tga',
    'tif': 'image/tiff',
    'tiff': 'image/tiff',
    'pmx': 'application/octet-stream',
    'pmd': 'application/octet-stream',
    'vmd': 'application/octet-stream',
    'sph': 'application/octet-stream',
    'spa': 'application/octet-stream'
  };
  return mimeTypes[ext || ''] || 'application/octet-stream';
}

/**
 * Formats file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}
