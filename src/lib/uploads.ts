import fs from "node:fs";
import path from "node:path";
export { MAX_PHOTOS } from "./uploads-client";
import { isEphemeralFs, photoPublicPath, uploadDir } from "./storage";

export async function saveUploadedPhotos(files: File[]): Promise<string[]> {
  const dir = uploadDir();
  const photos: string[] = [];
  for (const file of files) {
    if (!file.size) continue;
    const ext = path.extname(file.name) || ".jpg";
    const name = `${crypto.randomUUID()}${ext.toLowerCase()}`;
    const buf = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(path.join(dir, name), buf);
    if (isEphemeralFs()) {
      const { putPhoto } = await import("./cloud-db");
      await putPhoto(name, buf);
    }
    photos.push(photoPublicPath(name));
  }
  return photos;
}
