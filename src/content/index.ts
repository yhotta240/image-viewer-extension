import { DEFAULT_SETTINGS, type ImageViewerSettings } from "../settings";
import { logInfo } from "../utils/logger";
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
let galleryCache: GalleryImage[] | null = null;
let galleryCollection: Promise<GalleryImage[]> | null = null;
let settingsVersion = 0;

function collectFullGallery(): Promise<GalleryImage[]> {
  if (galleryCache) return Promise.resolve(galleryCache);
  if (galleryCollection) return galleryCollection;

  const version = settingsVersion;
  const pending = collectGalleryImages(settings).then((images) => {
    if (version === settingsVersion) galleryCache = images;
    return images;
  });
  galleryCollection = pending;
  void pending.then(
    () => {
      if (galleryCollection === pending) galleryCollection = null;
    },
    () => {
      if (galleryCollection === pending) galleryCollection = null;
    },
  );
  return pending;
}

async function completeGalleryCollection(version: number): Promise<void> {
  try {
    const images = await collectFullGallery();
    if (version === settingsVersion && viewer.open && images.length > 0) {
      viewer.replaceImages(images);
    }
  } catch {
    // 初期表示後の収集失敗では、表示中の一覧を維持する。
  }
}

async function openGallery(sourceUrl?: string): Promise<void> {
  if (!enabled) return;

  const quickImages = collectLoadedGalleryImages(settings);
  if (quickImages.length > 0) {
    viewer.openViewer(quickImages, findImageIndex(quickImages, sourceUrl));
    void logInfo(`画像ギャラリーを開きました (${quickImages.length}枚)`, "content", true);
    const version = settingsVersion;
    window.setTimeout(() => void completeGalleryCollection(version), 0);
    return;
  }

  const images = await collectFullGallery();
  if (images.length === 0) {
    viewer.showToast("表示できる画像がありません");
    return;
  }
  viewer.openViewer(images, findImageIndex(images, sourceUrl));
  void logInfo(`画像ギャラリーを開きました (${images.length}枚)`, "content", true);
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
        if (!settings.showHoverButton) viewer.scheduleHoverHide();
      });
    }
  });

  void logInfo(`ページ読み込み: ${document.title || location.pathname}`, "content", true);
}

void initialize().catch((error) => {
  console.error("Image Viewerの初期化に失敗しました", error);
});
