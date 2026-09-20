import { execFile } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { Page } from "playwright-core";
import type { Listing } from "../types";

const execFileAsync = promisify(execFile);

const FILE_PICKER =
  /upload( from computer)?|from computer|browse( files)?|choose file|add photos?|select photos?|select files|take photo|camera|drop photos/i;

const PHOTO_EMPTY =
  /add at least 1 photo|0\/25|0\/24|photos? with errors/i;

export function isFilePickerLabel(label: string) {
  return FILE_PICKER.test(label);
}

export async function listingPhotoPaths(listing: Listing) {
  const { readPhotoBytes, resolvePhotoFile } = await import("../storage");
  const raw = await Promise.all(
    listing.photos.map(async (photo) => {
      await readPhotoBytes(photo);
      return resolvePhotoFile(photo);
    })
  );
  return Promise.all(raw.map((file) => prepareMarketplacePhoto(file)));
}

async function imageSize(file: string) {
  try {
    const { stdout } = await execFileAsync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", file]);
    const width = Number(stdout.match(/pixelWidth:\s+(\d+)/)?.[1] || 0);
    const height = Number(stdout.match(/pixelHeight:\s+(\d+)/)?.[1] || 0);
    return { width, height };
  } catch {
    return { width: 0, height: 0 };
  }
}

/** eBay rejects photos under 500px on the longest side. */
export async function prepareMarketplacePhoto(src: string) {
  const { width, height } = await imageSize(src);
  const longest = Math.max(width, height);
  const alreadyJpeg = /\.jpe?g$/i.test(src);
  if (longest >= 500 && alreadyJpeg) return src;

  const destDir = path.join(process.cwd(), "data", "prepared-photos");
  mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, `${path.basename(src, path.extname(src))}.jpg`);
  try {
    await execFileAsync("sips", [
      "-Z",
      "1600",
      "-s",
      "format",
      "jpeg",
      "-s",
      "formatOptions",
      "80",
      src,
      "--out",
      dest,
    ]);
    return dest;
  } catch {
    return src;
  }
}

export async function photosAlreadyOnForm(page: Page, needed = 1) {
  const visible = await countListingPhotoThumbs(page);
  if (visible >= Math.max(1, needed)) return true;
  const body = await page.locator("body").innerText().catch(() => "");
  if (/\b([1-9]|1\d|2[0-4])\/2[45]\b/.test(body)) return true;
  if (PHOTO_EMPTY.test(body)) return false;
  const files = await page
    .locator('input[type="file"]')
    .evaluateAll((nodes) =>
      nodes.reduce((sum, node) => {
        const input = node as HTMLInputElement;
        return sum + (input.files?.length || 0);
      }, 0)
    )
    .catch(() => 0);
  return files >= Math.max(1, needed);
}

async function countListingPhotoThumbs(page: Page) {
  return page
    .evaluate(() => {
      const boxes = document.querySelectorAll(
        ".imgbox, #image_upload .imgbox, [class*='imgbox'], .thumbnails img, [class*='MediaThumbnail'] img, [class*='photo-thumb'] img"
      ).length;
      const uploads = Array.from(document.querySelectorAll("img")).filter((img) => {
        const src = img.getAttribute("src") || img.currentSrc || "";
        const rect = img.getBoundingClientRect();
        if (rect.width < 48 || rect.height < 48) return false;
        return (
          src.startsWith("blob:") ||
          /^data:image\/(?!svg)/i.test(src) ||
          /images\.craigslist\.org|i\.ebayimg\.com|fbcdn\.net|scontent/i.test(src)
        );
      }).length;
      return Math.max(boxes, uploads);
    })
    .catch(() => 0);
}

export async function ebayFormGaps(page: Page) {
  const body = await page.locator("body").innerText().catch(() => "");
  const gaps: string[] = [];
  if (PHOTO_EMPTY.test(body) && !/\b([1-9]|1\d|2[0-4])\/2[45]\b/.test(body)) {
    gaps.push("photos");
  }
  const listed =
    body.match(
      /looks like something is missing or invalid\.?\s*please fix any issues and try again\.?\s*([^\n]+)/i
    )?.[1] || "";
  if (/photos/i.test(listed) && !gaps.includes("photos")) gaps.push("photos");
  if (/item specifics/i.test(listed)) gaps.push("item specifics");
  if (/shipping/i.test(listed)) gaps.push("shipping");
  return [...new Set(gaps)];
}

async function waitForPhotos(page: Page, needed = 1, attempts = 6) {
  for (let i = 0; i < attempts; i += 1) {
    if (await photosAlreadyOnForm(page, needed)) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

async function setFilesInPage(page: Page, files: string[]) {
  const frames = page.frames();
  let tried = 0;
  for (const frame of frames) {
    const inputs = frame.locator('input[type="file"]');
    const count = await inputs.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      tried += 1;
      try {
        await inputs.nth(index).setInputFiles(files, { timeout: 4_000 });
        if (await waitForPhotos(page, files.length)) return true;
      } catch {
        /* try the next input */
      }
    }
  }
  return tried > 0 && (await photosAlreadyOnForm(page, files.length));
}

async function attachViaDrop(page: Page, files: string[]) {
  const payloads = files.map((file) => ({
    name: path.basename(file),
    mime: "image/jpeg",
    data: readFileSync(file).toString("base64"),
  }));

  await page
    .evaluate(async (items) => {
      const transferred = new DataTransfer();
      for (const item of items) {
        const bytes = Uint8Array.from(atob(item.data), (char) => char.charCodeAt(0));
        transferred.items.add(new File([bytes], item.name, { type: item.mime }));
      }

      const walk = (root: Document | ShadowRoot, acc: HTMLInputElement[]) => {
        root.querySelectorAll('input[type="file"]').forEach((node) => {
          acc.push(node as HTMLInputElement);
        });
        root.querySelectorAll("*").forEach((node) => {
          if (node.shadowRoot) walk(node.shadowRoot, acc);
        });
      };
      const inputs: HTMLInputElement[] = [];
      walk(document, inputs);
      for (const input of inputs) {
        try {
          input.files = transferred.files;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        } catch {
          /* some browsers lock input.files */
        }
      }

      const zone =
        (document.querySelector('[class*="dropzone" i], [class*="uploader" i], [data-testid*="upload" i]') as
          | HTMLElement
          | null) ||
        (Array.from(document.querySelectorAll("p, span, div, button")).find((node) =>
          /drag and drop files/i.test(node.textContent || "")
        ) as HTMLElement | undefined) ||
        document.body;

      for (const type of ["dragenter", "dragover", "drop"] as const) {
        zone.dispatchEvent(
          new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            dataTransfer: transferred,
          })
        );
      }
    }, payloads)
    .catch(() => undefined);

  return waitForPhotos(page, files.length);
}

export async function attachListingPhotos(page: Page, listing: Listing) {
  if (!listing.photos.length) return false;
  if (await photosAlreadyOnForm(page, listing.photos.length)) return true;
  await page
    .getByRole("button", { name: /^close$/i })
    .first()
    .click({ timeout: 1_200 })
    .catch(() => undefined);
  const files = await listingPhotoPaths(listing);
  if (await setFilesInPage(page, files)) return true;
  if (await attachViaDrop(page, files)) return true;
  return photosAlreadyOnForm(page, listing.photos.length);
}

export function armPhotoChooser(page: Page, listing: Listing) {
  const handler = async (chooser: { setFiles: (paths: string[]) => Promise<void> }) => {
    if (await photosAlreadyOnForm(page, listing.photos.length)) return;
    const files = await listingPhotoPaths(listing);
    await chooser.setFiles(files).catch(() => undefined);
  };
  page.on("filechooser", handler);
  return () => page.off("filechooser", handler);
}
