import { zipSync } from "fflate";
import type { ViewerImage } from "./collector";
import {
  getDownloadFilename,
  getUniqueFilename,
  getZipFilename,
  saveBlob,
  saveUrl,
} from "./download-utils";

export type CurrentDownloadResult = {
  ok: boolean;
  filename?: string;
};

export type ZipDownloadResult = {
  ok: boolean;
  downloaded: number;
  failed: number;
};

type FetchedImage = {
  url: string;
  blob: Blob;
};

async function fetchBlob(url: string): Promise<Blob> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.blob();
}

async function fetchRemoteBlob(url: string): Promise<FetchedImage | null> {
  try {
    const response = await chrome.runtime.sendMessage({ type: "FETCH_IMAGE", url });
    if (!response?.ok || !response.dataUrl) return null;
    return { url: response.url || url, blob: await fetchBlob(response.dataUrl) };
  } catch {
    return null;
  }
}

async function fetchImage(image: ViewerImage): Promise<FetchedImage | null> {
  for (const url of [image.url, image.fallbackUrl]) {
    if (!url) continue;
    if (url.startsWith("http://") || url.startsWith("https://")) {
      const fetched = await fetchRemoteBlob(url);
      if (fetched) return fetched;
      continue;
    }
    try {
      return { url, blob: await fetchBlob(url) };
    } catch {}
  }
  return null;
}

export async function downloadCurrentImage(
  image: ViewerImage,
  displayedUrl?: string,
): Promise<CurrentDownloadResult> {
  const url = displayedUrl || image.url;
  const filename = getDownloadFilename(url, "image");
  const protocol = new URL(url, document.baseURI).protocol;

  if (protocol !== "http:" && protocol !== "https:") {
    saveUrl(url, filename);
    return { ok: true, filename };
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: "DOWNLOAD_IMAGE",
      url,
      filename,
    });
    return response?.ok ? { ok: true, filename } : { ok: false };
  } catch {
    return { ok: false };
  }
}

export async function downloadImagesZip(images: ViewerImage[]): Promise<ZipDownloadResult> {
  const entries: Record<string, Uint8Array> = {};
  const usedFilenames = new Set<string>();
  let failed = 0;

  for (const [index, image] of images.entries()) {
    const fetched = await fetchImage(image);
    if (!fetched) {
      failed += 1;
      continue;
    }
    const fallbackName = `image-${String(index + 1).padStart(3, "0")}`;
    const filename = getUniqueFilename(
      getDownloadFilename(fetched.url, fallbackName, fetched.blob),
      usedFilenames,
    );
    entries[filename] = new Uint8Array(await fetched.blob.arrayBuffer());
  }

  const downloaded = Object.keys(entries).length;
  if (downloaded === 0) return { ok: false, downloaded, failed };

  const archive = zipSync(entries);
  const filename = getZipFilename();
  saveBlob(new Blob([archive], { type: "application/zip" }), filename);
  return { ok: true, downloaded, failed };
}
