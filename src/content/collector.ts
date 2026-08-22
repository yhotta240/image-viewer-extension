import type { ImageViewerSettings } from "../settings";

export type GalleryImage = {
  url: string;
  fallbackUrl?: string;
  source: "img" | "background";
  alt?: string;
};

const MIN_RENDERED_SIZE = 64;
const PROBE_TIMEOUT_MS = 1500;
const IMAGE_EXTENSION_PATTERN = /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)(?:$|[?#])/i;
const IMAGE_QUERY_PATTERN = /(?:format|fm|type)=(?:avif|bmp|gif|jpe?g|png|svg|webp)(?:&|$)/i;

type RawCandidate = GalleryImage & { element?: HTMLElement };
type ImageSize = { width: number; height: number } | null;

function toSafeUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, document.baseURI);
    if (!["http:", "https:", "data:", "blob:"].includes(url.protocol)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function normalizeUrl(value: string): string {
  try {
    const url = new URL(value, document.baseURI);
    url.hash = "";
    return url.href;
  } catch {
    return value;
  }
}

function isLikelyImageUrl(value: string): boolean {
  return IMAGE_EXTENSION_PATTERN.test(value) || IMAGE_QUERY_PATTERN.test(value);
}

function hasVisibleArea(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0")
    return false;
  const rect = element.getBoundingClientRect();
  return (
    rect.width >= MIN_RENDERED_SIZE &&
    rect.height >= MIN_RENDERED_SIZE &&
    rect.width * rect.height >= MIN_RENDERED_SIZE * MIN_RENDERED_SIZE
  );
}

function extractBackgroundUrls(value: string): string[] {
  const urls: string[] = [];
  const pattern = /url\(\s*(?:"([^"]+)"|'([^']+)'|([^'"\s)]+))\s*\)/gi;
  for (const match of value.matchAll(pattern)) {
    const raw = match[1] ?? match[2] ?? match[3];
    const url = toSafeUrl(raw);
    if (url) urls.push(url);
  }
  return urls;
}

function collectRawCandidates(settings: ImageViewerSettings): RawCandidate[] {
  const candidates: RawCandidate[] = [];

  for (const image of Array.from(document.images)) {
    if (!hasVisibleArea(image)) continue;
    const sourceUrl = toSafeUrl(image.currentSrc || image.src || image.getAttribute("src"));
    if (!sourceUrl) continue;

    const link = image.closest<HTMLAnchorElement>("a[href]");
    const linkedUrl = toSafeUrl(link?.href);
    const linkedCandidate =
      linkedUrl && linkedUrl !== sourceUrl && isLikelyImageUrl(linkedUrl) ? linkedUrl : null;
    const url = linkedCandidate ?? sourceUrl;
    const fallbackUrl = linkedCandidate ? sourceUrl : undefined;
    candidates.push({ url, fallbackUrl, source: "img", element: image });
  }

  if (settings.includeBackgroundImages) {
    const elements = [
      document.documentElement,
      ...(document.body ? [document.body] : []),
      ...Array.from(document.querySelectorAll<HTMLElement>("body *")),
    ];
    for (const element of new Set(elements)) {
      if (!hasVisibleArea(element)) continue;
      for (const url of extractBackgroundUrls(getComputedStyle(element).backgroundImage)) {
        candidates.push({ url, source: "background", element });
      }
    }
  }

  return candidates;
}

function probeImage(url: string): Promise<ImageSize> {
  return new Promise((resolve) => {
    const image = new Image();
    let settled = false;
    const finish = (value: ImageSize) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(null), PROBE_TIMEOUT_MS);
    image.onload = () => finish({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => finish(null);
    image.src = url;
  });
}

function getElementSize(candidate: RawCandidate): ImageSize {
  if (candidate.element instanceof HTMLImageElement && candidate.element.currentSrc) {
    if (candidate.element.naturalWidth === 0 || candidate.element.naturalHeight === 0) return null;
    return {
      width: candidate.element.naturalWidth,
      height: candidate.element.naturalHeight,
    };
  }
  return null;
}

export function isPotentialImageElement(element: HTMLImageElement): boolean {
  return Boolean(toSafeUrl(element.currentSrc || element.src)) && hasVisibleArea(element);
}

export function findImageIndex(images: GalleryImage[], sourceUrl?: string): number {
  if (!sourceUrl) return 0;
  const normalized = normalizeUrl(sourceUrl);
  const index = images.findIndex(
    (image) =>
      normalizeUrl(image.url) === normalized ||
      normalizeUrl(image.fallbackUrl ?? "") === normalized,
  );
  return index >= 0 ? index : 0;
}

export async function collectGalleryImages(settings: ImageViewerSettings): Promise<GalleryImage[]> {
  const rawCandidates = collectRawCandidates(settings);
  const probeCache = new Map<string, Promise<ImageSize>>();
  const getSize = (candidate: RawCandidate, url: string): Promise<ImageSize> => {
    const elementSize = getElementSize(candidate);
    if (
      elementSize &&
      normalizeUrl(url) ===
        normalizeUrl(
          candidate.element instanceof HTMLImageElement ? candidate.element.currentSrc : "",
        )
    ) {
      return Promise.resolve(elementSize);
    }
    const key = normalizeUrl(url);
    const cached = probeCache.get(key);
    if (cached) return cached;
    const pending = probeImage(url);
    probeCache.set(key, pending);
    return pending;
  };

  const evaluated = await Promise.all(
    rawCandidates.map(async (candidate) => {
      const sizes = await Promise.all([
        getSize(candidate, candidate.url),
        candidate.fallbackUrl ? getSize(candidate, candidate.fallbackUrl) : Promise.resolve(null),
      ]);
      const isLargeEnough = sizes.some((size) =>
        Boolean(
          size && size.width >= settings.minImageSize && size.height >= settings.minImageSize,
        ),
      );
      return isLargeEnough ? candidate : null;
    }),
  );

  const accepted: GalleryImage[] = [];
  const seen = new Set<string>();
  for (const candidate of evaluated) {
    if (!candidate) continue;
    const key = `${normalizeUrl(candidate.url)}|${normalizeUrl(candidate.fallbackUrl ?? "")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    accepted.push({
      url: candidate.url,
      fallbackUrl: candidate.fallbackUrl,
      source: candidate.source,
      alt: candidate.element instanceof HTMLImageElement ? candidate.element.alt : undefined,
    });
  }
  return accepted;
}
