import type { ImageViewerSettings } from "../settings";

export type ViewerImage = {
  url: string;
  fallbackUrl?: string;
  source: "img" | "background";
  alt?: string;
};

const MIN_RENDERED_SIZE = 64;
const IMAGE_REFRESH_DELAY_MS = 300;
const EXTENSION_HOST_SELECTOR = "#image-viewer-extension-root, #image-viewer-extension-hover-root";
const IMAGE_EXTENSION_PATTERN = /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)(?:$|[?#])/i;
const IMAGE_QUERY_PATTERN = /(?:format|fm|type)=(?:avif|bmp|gif|jpe?g|png|svg|webp)(?:&|$)/i;

type RawCandidate = ViewerImage & { element?: HTMLElement };
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

function collectImageCandidates(): RawCandidate[] {
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

  return candidates;
}

function collectRawCandidates(settings: ImageViewerSettings): RawCandidate[] {
  const candidates = collectImageCandidates();

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

export function isPotentialImageElement(element: HTMLImageElement, minImageSize: number): boolean {
  return (
    Boolean(toSafeUrl(element.currentSrc || element.src)) &&
    hasVisibleArea(element) &&
    element.naturalWidth >= minImageSize &&
    element.naturalHeight >= minImageSize
  );
}

function isLargeEnough(size: ImageSize, minImageSize: number): boolean {
  return Boolean(size && size.width >= minImageSize && size.height >= minImageSize);
}

function toViewerImages(candidates: RawCandidate[]): ViewerImage[] {
  const accepted: ViewerImage[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
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

export function collectLoadedViewerImages(settings: ImageViewerSettings): ViewerImage[] {
  const candidates = collectImageCandidates().filter((candidate) =>
    isLargeEnough(getElementSize(candidate), settings.minImageSize),
  );
  return toViewerImages(candidates);
}

export function findImageIndex(images: ViewerImage[], sourceUrl?: string): number {
  if (!sourceUrl) return 0;
  const normalized = normalizeUrl(sourceUrl);
  const index = images.findIndex(
    (image) =>
      normalizeUrl(image.url) === normalized ||
      normalizeUrl(image.fallbackUrl ?? "") === normalized,
  );
  return index >= 0 ? index : 0;
}

type ImageProbe = {
  image: HTMLImageElement;
  size: ImageSize;
  settled: boolean;
};

function isExtensionMutation(record: MutationRecord): boolean {
  const target = record.target instanceof Element ? record.target : record.target.parentElement;
  if (target?.closest(EXTENSION_HOST_SELECTOR)) return true;
  if (record.type !== "childList") return false;
  const nodes = [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)];
  return (
    nodes.length > 0 &&
    nodes.every((node) => node instanceof Element && node.closest(EXTENSION_HOST_SELECTOR) === node)
  );
}

export function observeViewerImages(
  settings: ImageViewerSettings,
  onUpdate: (images: ViewerImage[], loading: boolean) => void,
  onError: (error: unknown) => void,
): () => void {
  const probes = new Map<string, ImageProbe>();
  let candidates: RawCandidate[] = [];
  let previousImages: ViewerImage[] | undefined;
  let previousLoading = false;
  let refreshTimer: number | undefined;
  let disconnected = false;

  const getSize = (candidate: RawCandidate, url: string): ImageSize => {
    const elementSize = getElementSize(candidate);
    if (
      elementSize &&
      normalizeUrl(url) ===
        normalizeUrl(
          candidate.element instanceof HTMLImageElement ? candidate.element.currentSrc : "",
        )
    ) {
      return elementSize;
    }
    return probes.get(normalizeUrl(url))?.size ?? null;
  };

  const publish = (): void => {
    if (disconnected) return;
    const accepted = candidates.filter((candidate) =>
      [candidate.url, candidate.fallbackUrl].some(
        (url) => url && isLargeEnough(getSize(candidate, url), settings.minImageSize),
      ),
    );
    const images = toViewerImages(accepted);
    const loading = Array.from(probes.values()).some((probe) => !probe.settled);
    const unchanged =
      previousImages?.length === images.length &&
      previousImages.every((image, index) => {
        const next = images[index];
        return (
          image.url === next.url &&
          image.fallbackUrl === next.fallbackUrl &&
          image.source === next.source &&
          image.alt === next.alt
        );
      });
    if (unchanged && loading === previousLoading) return;
    previousImages = images;
    previousLoading = loading;
    onUpdate(images, loading);
  };

  const releaseProbe = (probe: ImageProbe): void => {
    probe.image.onload = null;
    probe.image.onerror = null;
    probe.image.removeAttribute("src");
  };

  const startProbe = (url: string): void => {
    const key = normalizeUrl(url);
    if (probes.has(key)) return;
    const image = new Image();
    const probe: ImageProbe = { image, size: null, settled: false };
    probes.set(key, probe);
    const finish = (size: ImageSize): void => {
      if (disconnected || probes.get(key) !== probe) return;
      probe.size = size;
      probe.settled = true;
      image.onload = null;
      image.onerror = null;
      publish();
    };
    image.onload = () => finish({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => finish(null);
    image.src = url;
  };

  const refresh = (): void => {
    if (disconnected) return;
    try {
      candidates = collectRawCandidates(settings);
      const activeUrls = new Set<string>();
      for (const candidate of candidates) {
        for (const url of [candidate.url, candidate.fallbackUrl]) {
          if (!url) continue;
          activeUrls.add(normalizeUrl(url));
          if (!getSize(candidate, url)) startProbe(url);
        }
      }
      for (const [key, probe] of probes) {
        if (activeUrls.has(key)) continue;
        probes.delete(key);
        releaseProbe(probe);
      }
      publish();
    } catch (error) {
      onError(error);
    }
  };

  // 変化が続くページでも、更新を先送りし続けない。
  const scheduleRefresh = (): void => {
    if (disconnected || refreshTimer !== undefined) return;
    refreshTimer = window.setTimeout(() => {
      refreshTimer = undefined;
      refresh();
    }, IMAGE_REFRESH_DELAY_MS);
  };

  const handleLoad = (event: Event): void => {
    const target = event.target;
    if (
      target instanceof Element &&
      (target instanceof HTMLImageElement || target.tagName === "LINK") &&
      !target.closest(EXTENSION_HOST_SELECTOR)
    ) {
      scheduleRefresh();
    }
  };
  const observer = new MutationObserver((records) => {
    if (!records.every(isExtensionMutation)) scheduleRefresh();
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: [
      "class",
      "style",
      "src",
      "srcset",
      "sizes",
      "href",
      "data-src",
      "data-srcset",
    ],
  });
  document.addEventListener("load", handleLoad, true);
  window.addEventListener("resize", scheduleRefresh);
  refresh();

  return () => {
    disconnected = true;
    observer.disconnect();
    document.removeEventListener("load", handleLoad, true);
    window.removeEventListener("resize", scheduleRefresh);
    if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
    for (const probe of probes.values()) releaseProbe(probe);
    probes.clear();
  };
}
