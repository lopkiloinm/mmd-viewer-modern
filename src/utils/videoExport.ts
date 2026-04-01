import JSZip from 'jszip';

const padFrame = (frameIndex: number) => frameIndex.toString().padStart(6, '0');

export interface ExportPngSequenceOptions {
  frameCount: number;
  fps: number;
  onProgress?: (value: number) => void;
  getFrame: (frameIndex: number) => Promise<Blob>;
}

export const exportPngSequenceToZip = async ({
  frameCount,
  onProgress,
  getFrame,
}: ExportPngSequenceOptions): Promise<Blob> => {
  const zip = new JSZip();
  const framesFolder = zip.folder('frames');

  if (!framesFolder) {
    throw new Error('Failed to create frames folder in ZIP');
  }

  const safeFrameCount = Math.max(1, Math.round(frameCount));

  for (let frameIndex = 0; frameIndex < safeFrameCount; frameIndex += 1) {
    const blob = await getFrame(frameIndex);
    const fileName = `frame_${padFrame(frameIndex)}.png`;
    const arrayBuffer = await blob.arrayBuffer();
    framesFolder.file(fileName, arrayBuffer);
    onProgress?.((frameIndex + 1) / safeFrameCount);
  }

  const zipBlob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  return zipBlob;
};
