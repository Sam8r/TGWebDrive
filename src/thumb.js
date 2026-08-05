import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config.js";

const THUMB_DIR = path.join(DATA_DIR, "thumbs");
fs.mkdirSync(THUMB_DIR, { recursive: true });

export function thumbCachePath(key) {
  return path.join(THUMB_DIR, `${key}.jpg`);
}

// Generate a small JPEG thumbnail from an image path or buffer.
export async function generateThumb(input, outPath) {
  const pipeline = sharp(input, { failOn: "none" }).rotate().resize(480, 480, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 78 });
  if (outPath) {
    await pipeline.toFile(outPath);
    return outPath;
  }
  return pipeline.toBuffer();
}

export const IMAGE_RE = /\.(jpe?g|png|webp|gif|bmp|tiff?|avif|heic|heif)$/i;
