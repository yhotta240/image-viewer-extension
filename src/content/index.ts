import { DEFAULT_SETTINGS, type ImageViewerSettings } from "../settings";
import { logError } from "../utils/logger";
import { getSettings, isEnabled } from "../utils/storage";
import {
  collectGalleryImages,
  collectLoadedGalleryImages,
  findImageIndex,
  type GalleryImage,
  isPotentialImageElement,
} from "./collector";
import { createImageViewer, type ImageViewer } from "./viewer";

type OpenViewerMessage = {
  type: "OPEN_VIEWER";
  sourceUrl?: string;
};

let settings: ImageViewerSettings = DEFAULT_SETTINGS;
let enabled = true;
const viewer: ImageViewer = createImageViewer();
type GalleryCache = {
  settingsVersion: number;
  pageVersion: number;
  images: GalleryImage[];
};

type GalleryCollection = {
  settingsVersion: number;
  pageVersion: number;
  promise: Promise<GalleryImage[]>;
};

let galleryCache: GalleryCache | null = null;
let galleryCollection: GalleryCollection | null = null;
let settingsVersion = 0;
let pageVersion = 0;
let galleryRefreshTimer: number | undefined;

const extensionHostSelector = "#image-viewer-extension-root, #image-viewer-extension-hover-root";
const GALLERY_REFRESH_DEBOUNCE_MS = 300;

function isExtensionMutation(record: MutationRecord): boolean {
  const target = record.target instanceof Element ? record.target : record.target.parentElement;
  if (target?.closest(extensionHostSelector)) return true;
  if (record.type !== "childList") return false;

  const changedNodes = [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)];
  return (
    changedNodes.length > 0 &&
    changedNodes.every(
      (node) => node instanceof Element && node.closest(extensionHostSelector) === node,
    )
  );
}

function setupGalleryInvalidation(): void {
  const root = document.documentElement;
  if (!root) return;

  const observer = new MutationObserver((records) => {
    if (records.every(isExtensionMutation)) return;
    pageVersion += 1;
    galleryCache = null;
    scheduleGalleryRefresh();
  });
  observer.observe(root, {
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
}

function collectFullGallery(): Promise<GalleryImage[]> {
  const requestedSettingsVersion = settingsVersion;
  const requestedPageVersion = pageVersion;
  if (
    galleryCache?.settingsVersion === requestedSettingsVersion &&
    galleryCache.pageVersion === requestedPageVersion
  ) {
    return Promise.resolve(galleryCache.images);
  }
  if (
    galleryCollection?.settingsVersion === requestedSettingsVersion &&
    galleryCollection.pageVersion === requestedPageVersion
  ) {
    return galleryCollection.promise;
  }

  const pending = collectGalleryImages(settings).then((images) => {
    if (requestedSettingsVersion === settingsVersion && requestedPageVersion === pageVersion) {
      galleryCache = {
        settingsVersion: requestedSettingsVersion,
        pageVersion: requestedPageVersion,
        images,
      };
    }
    return images;
  });
  const collection: GalleryCollection = {
    settingsVersion: requestedSettingsVersion,
    pageVersion: requestedPageVersion,
    promise: pending,
  };
  galleryCollection = collection;
  void pending.then(
    () => {
      if (galleryCollection === collection) galleryCollection = null;
    },
    () => {
      if (galleryCollection === collection) galleryCollection = null;
    },
  );
  return pending;
}

async function completeGalleryCollection(
  expectedSettingsVersion: number,
  expectedPageVersion: number,
): Promise<void> {
  try {
    const images = await collectFullGallery();
    if (
      expectedSettingsVersion === settingsVersion &&
      expectedPageVersion === pageVersion &&
      viewer.open &&
      images.length > 0
    ) {
      viewer.replaceImages(images);
    }
  } catch (error) {
    // 初期表示後の収集失敗では、表示中の一覧を維持する。
    void logError("表示中の画像収集に失敗しました", "content", error);
  }
}

function scheduleGalleryRefresh(): void {
  if (!viewer.open) return;
  if (galleryRefreshTimer !== undefined) window.clearTimeout(galleryRefreshTimer);
  galleryRefreshTimer = window.setTimeout(() => {
    galleryRefreshTimer = undefined;
    if (viewer.open) {
      void completeGalleryCollection(settingsVersion, pageVersion);
    }
  }, GALLERY_REFRESH_DEBOUNCE_MS);
}

async function openGallery(sourceUrl?: string): Promise<void> {
  if (!enabled) return;

  const quickImages = collectLoadedGalleryImages(settings);
  if (quickImages.length > 0) {
    viewer.openViewer(quickImages, findImageIndex(quickImages, sourceUrl));
    const expectedSettingsVersion = settingsVersion;
    const expectedPageVersion = pageVersion;
    window.setTimeout(
      () => void completeGalleryCollection(expectedSettingsVersion, expectedPageVersion),
      0,
    );
    return;
  }

  let images: GalleryImage[];
  try {
    images = await collectFullGallery();
  } catch (error) {
    void logError("画像の収集に失敗しました", "content", error);
    viewer.showToast("画像を収集できませんでした");
    return;
  }
  if (images.length === 0) {
    viewer.showToast("表示できる画像がありません");
    return;
  }
  viewer.openViewer(images, findImageIndex(images, sourceUrl));
}

function getImageTarget(target: EventTarget | null): HTMLImageElement | null {
  if (target instanceof HTMLImageElement) return target;
  return null;
}

function setupHoverActivation(): void {
  let hoveredImage: HTMLImageElement | null = null;
  const showHoverButtonIfEligible = (image: HTMLImageElement): void => {
    if (
      hoveredImage !== image ||
      !enabled ||
      !settings.showHoverButton ||
      viewer.open ||
      !isPotentialImageElement(image, settings.minImageSize)
    ) {
      return;
    }
    viewer.showHoverButton(image, () => void openGallery(image.currentSrc || image.src));
  };

  document.addEventListener(
    "pointerover",
    (event) => {
      const image = getImageTarget(event.target);
      if (!image) return;
      hoveredImage = image;
      showHoverButtonIfEligible(image);
    },
    true,
  );

  document.addEventListener(
    "load",
    (event) => {
      const image = getImageTarget(event.target);
      if (image) showHoverButtonIfEligible(image);
    },
    true,
  );

  document.addEventListener(
    "pointerout",
    (event) => {
      const image = getImageTarget(event.target);
      if (image && event.relatedTarget !== image) {
        if (hoveredImage === image) hoveredImage = null;
        viewer.scheduleHoverHide();
      }
    },
    true,
  );
}

function setupAltClickActivation(): void {
  document.addEventListener(
    "click",
    (event) => {
      if (!enabled || !event.altKey || event.button !== 0) return;
      const image = getImageTarget(event.target);
      if (!image || !isPotentialImageElement(image, settings.minImageSize)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void openGallery(image.currentSrc || image.src);
    },
    true,
  );
}

function setupMessages(): void {
  chrome.runtime.onMessage.addListener((message: OpenViewerMessage) => {
    if (message?.type === "OPEN_VIEWER") void openGallery(message.sourceUrl);
  });
}

async function initialize(): Promise<void> {
  settings = await getSettings();
  enabled = await isEnabled();
  setupGalleryInvalidation();
  setupHoverActivation();
  setupAltClickActivation();
  setupMessages();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.enabled) enabled = changes.enabled.newValue !== false;
    if (changes.settings) {
      void getSettings().then((nextSettings) => {
        settings = nextSettings;
        settingsVersion += 1;
        galleryCache = null;
        scheduleGalleryRefresh();
        if (!settings.showHoverButton) viewer.scheduleHoverHide();
      });
    }
  });
}

void initialize().catch((error) => {
  console.error("Image Viewerの初期化に失敗しました", error);
  void logError("Image Viewerの初期化に失敗しました", "content", error);
});
