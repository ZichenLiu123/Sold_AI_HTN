import fs from "node:fs";
import path from "node:path";

export function isEphemeralFs() {
  return Boolean(process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

export function dataDir() {
  const dir = isEphemeralFs()
    ? path.join("/tmp", "sold-data")
    : path.join(process.cwd(), "data");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function uploadDir() {
  const dir = isEphemeralFs()
    ? path.join("/tmp", "sold-uploads")
    : path.join(process.cwd(), "public", "uploads");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function photoPublicPath(filename: string) {
  return isEphemeralFs() ? `/api/uploads/${filename}` : `/uploads/${filename}`;
}

export function resolvePhotoFile(photoUrl: string) {
  const name = path.basename(photoUrl.split("?")[0] || "");
  const candidates = [
    path.join(uploadDir(), name),
    path.join(process.cwd(), "public", "uploads", name),
    path.join(process.cwd(), "public", photoUrl.replace(/^\//, "")),
  ];
  return candidates.find((file) => fs.existsSync(file)) || candidates[0];
}

export async function readPhotoBytes(photoUrl: string): Promise<Buffer> {
  const name = path.basename(photoUrl.split("?")[0] || "");
  const filePath = resolvePhotoFile(photoUrl);
  if (fs.existsSync(filePath)) return fs.readFileSync(filePath);
  if (isEphemeralFs() && name) {
    const { getPhoto } = await import("./cloud-db");
    const bytes = await getPhoto(name);
    if (bytes) {
      fs.mkdirSync(uploadDir(), { recursive: true });
      fs.writeFileSync(filePath, bytes);
      return Buffer.from(bytes);
    }
  }
  throw new Error(`Missing photo ${name || photoUrl}`);
}
