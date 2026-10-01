import { DEFAULT_SETTINGS, type ImageViewerSettings } from "../settings";
import { logError } from "../utils/logger";
import { getSettings, isEnabled } from "../utils/storage";
import {
  collectLoadedViewerImages,
  findImageIndex,
  isPotentialImageElement,
  observeViewerImages,
} from "./collector";
import { createImageViewer, type ImageViewer } from "./viewer";

type OpenViewerMessage = {
  type: "OPEN_VIEWER";
  sourceUrl?: string;
};

let settings: ImageViewerSettings = DEFAULT_SETTINGS;
let enabled = true;
let stopImageObservation: (() => void) | undefined;
const viewer: ImageViewer = createImageViewer(() => {
  stopImageObservation?.();
  stopImageObservation = undefined;
});

function startImageObservation(sourceUrl?: string, selectInitialImage = false): void {
  stopImageObservation?.();
  stopImageObservation = undefined;
  try {
    stopImageObservation = observeViewerImages(
      settings,
      (images, loading) => {
        if (!viewer.open) return;
        if (selectInitialImage && images.length > 0) {
          selectInitialImage = false;
          viewer.openViewer(images, findImageIndex(images, sourceUrl));
        } else {
          viewer.replaceImages(images, loading);
        }
      },
      (error) => void logError("表示中の画像収集に失敗しました", "content", error),
    );
  } catch (error) {
    void logError("表示中の画像収集に失敗しました", "content", error);
  }
}

function openViewer(sourceUrl?: string): void {
  if (!enabled) return;
  stopImageObservation?.();
  stopImageObservation = undefined;
  try {
    const images = collectLoadedViewerImages(settings);
    viewer.openViewer(images, findImageIndex(images, sourceUrl));
    startImageObservation(sourceUrl, images.length === 0);
  } catch (error) {
    void logError("画像の収集に失敗しました", "content", error);
    viewer.showToast("画像を収集できませんでした");
  }
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
    viewer.showHoverButton(image, () => openViewer(image.currentSrc || image.src));
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
      openViewer(image.currentSrc || image.src);
    },
    true,
  );
}

function setupMessages(): void {
  chrome.runtime.onMessage.addListener((message: OpenViewerMessage) => {
    if (message?.type === "OPEN_VIEWER") openViewer(message.sourceUrl);
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
    if (changes.enabled) {
      enabled = changes.enabled.newValue !== false;
      if (!enabled) viewer.closeViewer();
    }
    if (changes.settings) {
      void updateSettings();
    }
  });
}

async function updateSettings(): Promise<void> {
  try {
    settings = await getSettings();
    if (viewer.open) startImageObservation();
    if (!settings.showHoverButton) viewer.scheduleHoverHide();
  } catch (error) {
    void logError("画像表示設定の更新に失敗しました", "content", error);
  }
}

void initialize().catch((error) => {
  console.error("Image Viewerの初期化に失敗しました", error);
  void logError("Image Viewerの初期化に失敗しました", "content", error);
});
