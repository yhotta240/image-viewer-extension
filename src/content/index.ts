import { DEFAULT_SETTINGS, type ImageViewerSettings } from "../settings";
import { logInfo } from "../utils/logger";
import { getSettings, isEnabled } from "../utils/storage";
import { collectGalleryImages, findImageIndex, isPotentialImageElement } from "./collector";
import { createImageViewer, type ImageViewer } from "./viewer";

type OpenViewerMessage = {
  type: "OPEN_VIEWER";
  sourceUrl?: string;
};

let settings: ImageViewerSettings = DEFAULT_SETTINGS;
let enabled = true;
const viewer: ImageViewer = createImageViewer();

async function openGallery(sourceUrl?: string): Promise<void> {
  if (!enabled) return;
  const images = await collectGalleryImages(settings);
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
  document.addEventListener(
    "pointerover",
    (event) => {
      if (!enabled || !settings.showHoverButton || viewer.open) return;
      const image = getImageTarget(event.target);
      if (!image || !isPotentialImageElement(image, settings.minImageSize)) return;
      viewer.showHoverButton(image, () => void openGallery(image.currentSrc || image.src));
    },
    true,
  );

  document.addEventListener(
    "pointerout",
    (event) => {
      const image = getImageTarget(event.target);
      if (image && event.relatedTarget !== image) viewer.scheduleHoverHide();
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
        if (!settings.showHoverButton) viewer.scheduleHoverHide();
      });
    }
  });

  void logInfo(`ページ読み込み: ${document.title || location.pathname}`, "content", true);
}

void initialize().catch((error) => {
  console.error("Image Viewerの初期化に失敗しました", error);
});
