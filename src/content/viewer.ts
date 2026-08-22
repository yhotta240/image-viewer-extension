import {
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  createElement as createLucideElement,
  type IconNode,
  Images,
  Maximize2,
  Minimize2,
  RotateCw,
  X,
} from "lucide";
import { getStorage, setStorage } from "../utils/storage";
import type { GalleryImage } from "./collector";
import viewerStyle from "./viewer.css";
import { ImageInfoPanel } from "./viewer-info";

const HOST_ID = "image-viewer-extension-root";
const HOVER_HOST_ID = "image-viewer-extension-hover-root";
const HOVER_ANCHOR_NAME = "--image-viewer-target";
const WHEEL_THRESHOLD = 40;
const WHEEL_COOLDOWN_MS = 90;
const SWIPE_CLOSE_THRESHOLD = 80;

type ViewerElements = {
  viewer: HTMLDivElement;
  stage: HTMLDivElement;
  counter: HTMLSpanElement;
  image: HTMLImageElement;
  error: HTMLDivElement;
  prev: HTMLButtonElement;
  next: HTMLButtonElement;
  fullscreen: HTMLButtonElement;
  info: ImageInfoPanel;
  fit: HTMLButtonElement;
  rotate: HTMLButtonElement;
  close: HTMLButtonElement;
  hover: HTMLButtonElement;
};

function createHosts(): {
  viewerHost: HTMLDivElement;
  viewerShadow: ShadowRoot;
  hoverHost: HTMLDivElement;
  hoverShadow: ShadowRoot;
} {
  const existingViewer = document.getElementById(HOST_ID);
  const viewerHost =
    existingViewer instanceof HTMLDivElement ? existingViewer : document.createElement("div");
  viewerHost.id = HOST_ID;
  viewerHost.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;pointer-events:none;display:none;";
  const viewerShadow = viewerHost.shadowRoot ?? viewerHost.attachShadow({ mode: "open" });

  const existingHover = document.getElementById(HOVER_HOST_ID);
  const hoverHost =
    existingHover instanceof HTMLDivElement ? existingHover : document.createElement("div");
  hoverHost.id = HOVER_HOST_ID;
  hoverHost.style.cssText =
    `position:fixed;z-index:2147483647;pointer-events:none;display:none;` +
    `position-anchor:${HOVER_ANCHOR_NAME};top:anchor(top);left:anchor(right);` +
    "width:24px;height:24px;transform:translate(-29px,3px);";
  const hoverShadow = hoverHost.shadowRoot ?? hoverHost.attachShadow({ mode: "open" });

  if (!viewerHost.isConnected) document.documentElement.appendChild(viewerHost);
  if (!hoverHost.isConnected) document.documentElement.appendChild(hoverHost);
  return { viewerHost, viewerShadow, hoverHost, hoverShadow };
}

function makeButton(label: string, className: string, title: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = className;
  button.type = "button";
  button.textContent = label;
  button.title = title;
  button.setAttribute("aria-label", title);
  return button;
}

function appendLucideIcon(button: HTMLButtonElement, icon: IconNode, size: number): void {
  const svg = createLucideElement(icon, { width: size, height: size });
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.style.display = "block";
  button.append(svg);
}

export class ImageViewer {
  private readonly host: HTMLDivElement;
  private readonly hoverHost: HTMLDivElement;
  private readonly elements: ViewerElements;
  private images: GalleryImage[] = [];
  private index = 0;
  private zoom = 1;
  private fitMode = false;
  private rotation = 0;
  private panX = 0;
  private panY = 0;
  private swipeOffsetY = 0;
  private pointerStart: {
    x: number;
    y: number;
    panX: number;
    panY: number;
    onImage: boolean;
  } | null = null;
  private didDrag = false;
  private fallbackAttempted = false;
  private previousBodyOverflow = "";
  private hoverTarget: HTMLImageElement | null = null;
  private previousAnchorName = "";
  private previousAnchorPriority = "";
  private hoverHideTimer: number | undefined;
  private toastTimer: number | undefined;
  private wheelDelta = 0;
  private wheelCooldown = false;
  private wheelCooldownTimer: number | undefined;
  private isOpen = false;
  private readonly fitModeReady: Promise<void>;

  constructor() {
    const { viewerHost, viewerShadow, hoverHost, hoverShadow } = createHosts();
    this.host = viewerHost;
    this.hoverHost = hoverHost;
    viewerShadow.replaceChildren();
    hoverShadow.replaceChildren();
    const style = document.createElement("style");
    style.textContent = viewerStyle;
    const hoverStyle = document.createElement("style");
    hoverStyle.textContent = viewerStyle;

    const viewer = document.createElement("div");
    viewer.className = "viewer";
    viewer.hidden = true;
    viewer.setAttribute("role", "dialog");
    viewer.setAttribute("aria-modal", "true");
    viewer.setAttribute("aria-label", "Image Viewer");

    const topbar = document.createElement("div");
    topbar.className = "topbar";
    const fullscreen = makeButton("", "fullscreen", "全画面表示");
    appendLucideIcon(fullscreen, Maximize2, 18);
    const info = new ImageInfoPanel();
    const fit = makeButton("", "fit", "画面にフィット");
    appendLucideIcon(fit, ChevronsUpDown, 18);
    const rotate = makeButton("", "rotate", "90度回転");
    appendLucideIcon(rotate, RotateCw, 18);
    const close = makeButton("", "close", "閉じる");
    appendLucideIcon(close, X, 18);
    const counter = document.createElement("span");
    counter.className = "counter";
    topbar.append(fit, rotate, fullscreen, info.element, close);

    const stage = document.createElement("div");
    stage.className = "stage";
    const image = document.createElement("img");
    image.className = "main-image";
    image.alt = "";
    image.draggable = false;
    const error = document.createElement("div");
    error.className = "error";
    stage.append(image, error);

    const prev = makeButton("", "nav prev", "前の画像");
    const next = makeButton("", "nav next", "次の画像");
    appendLucideIcon(prev, ChevronLeft, 22);
    appendLucideIcon(next, ChevronRight, 22);
    stage.append(prev, next);
    viewer.append(topbar, stage, counter);

    const hover = makeButton("", "hover-button", "Image Viewerで開く (Alt + クリック)");
    appendLucideIcon(hover, Images, 14);
    hover.hidden = true;
    hover.addEventListener("pointerenter", () => this.cancelHoverHide());
    hover.addEventListener("pointerleave", () => this.scheduleHoverHide());

    viewerShadow.append(style, viewer);
    hoverShadow.append(hoverStyle, hover);
    this.host.style.display = "none";
    this.hoverHost.style.display = "none";
    this.elements = {
      viewer,
      stage,
      counter,
      image,
      error,
      prev,
      next,
      fullscreen,
      info,
      fit,
      rotate,
      close,
      hover,
    };
    this.updateFullscreenButton();
    this.updateFitButton();
    this.setupEvents();
    this.fitModeReady = this.restoreFitMode();
  }

  get open(): boolean {
    return this.isOpen;
  }

  async openViewer(images: GalleryImage[], initialIndex = 0): Promise<void> {
    if (images.length === 0) return;
    await this.fitModeReady;
    const wasOpen = this.isOpen;
    if (!wasOpen) {
      this.previousBodyOverflow = document.body?.style.overflow ?? "";
      if (document.body) document.body.style.overflow = "hidden";
    }
    this.images = images;
    this.index = ((initialIndex % images.length) + images.length) % images.length;
    this.isOpen = true;
    this.resetWheelState();
    this.resetSwipeVisuals(false);
    this.updateFullscreenButton();
    this.clearHoverAnchor();
    this.hoverHost.style.display = "none";
    this.elements.hover.hidden = true;
    this.elements.viewer.hidden = false;
    this.host.style.display = "block";
    this.resetZoom();
    this.render();
    this.elements.close.focus({ preventScroll: true });
  }

  closeViewer(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.resetWheelState();
    this.resetSwipeVisuals(false);
    if (document.fullscreenElement === this.host) void document.exitFullscreen();
    this.elements.viewer.hidden = true;
    this.elements.hover.hidden = true;
    this.clearHoverAnchor();
    this.hoverHost.style.display = "none";
    this.cancelHoverHide();
    if (document.body) document.body.style.overflow = this.previousBodyOverflow;
    this.host.style.display = "none";
  }

  showHoverButton(target: HTMLImageElement, open: () => void): void {
    if (this.isOpen) return;
    this.cancelHoverHide();
    const { hover } = this.elements;
    this.setHoverAnchor(target);
    this.hoverHost.style.display = "block";
    hover.hidden = false;
    hover.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      open();
    };
  }

  scheduleHoverHide(): void {
    this.cancelHoverHide();
    this.hoverHideTimer = window.setTimeout(() => {
      if (!this.elements.hover.matches(":hover") && this.hoverTarget) {
        this.elements.hover.hidden = true;
        this.clearHoverAnchor();
        this.hoverHost.style.display = "none";
      }
    }, 300);
  }

  cancelHoverHide(): void {
    if (this.hoverHideTimer !== undefined) window.clearTimeout(this.hoverHideTimer);
    this.hoverHideTimer = undefined;
  }

  showToast(message: string): void {
    this.elements.hover.hidden = true;
    this.clearHoverAnchor();
    this.hoverHost.style.display = "none";
    this.cancelHoverHide();
    const root = this.elements.viewer.getRootNode();
    const existing = root instanceof ShadowRoot ? root.querySelector(".toast") : null;
    existing?.remove();
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.setAttribute("role", "status");
    toast.textContent = message;
    if (root instanceof ShadowRoot) root.append(toast);
    this.host.style.display = "block";
    if (this.toastTimer !== undefined) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      toast.remove();
      if (!this.isOpen && this.elements.hover.hidden) this.host.style.display = "none";
    }, 2400);
  }

  private setupEvents(): void {
    const { viewer, close, prev, next, fullscreen, fit, rotate, image } = this.elements;
    close.addEventListener("click", () => this.closeViewer());
    prev.addEventListener("click", () => this.move(-1));
    next.addEventListener("click", () => this.move(1));
    fullscreen.addEventListener("click", () => void this.toggleFullscreen());
    fit.addEventListener("click", () => {
      this.fitMode = !this.fitMode;
      this.zoom = 1;
      this.panX = 0;
      this.panY = 0;
      this.swipeOffsetY = 0;
      this.didDrag = false;
      this.updateFitButton();
      void setStorage({ fitMode: this.fitMode }).catch(() => undefined);
      this.applyTransform();
    });
    rotate.addEventListener("click", () => {
      this.rotation = (this.rotation + 90) % 360;
      this.panX = 0;
      this.panY = 0;
      this.swipeOffsetY = 0;
      this.applyTransform();
    });
    document.addEventListener("fullscreenchange", () => this.updateFullscreenButton());
    window.addEventListener("resize", () => {
      if (this.isOpen) this.applyTransform();
    });
    viewer.addEventListener(
      "wheel",
      (event) => {
        if (!this.isOpen || event.target === image) return;
        event.preventDefault();
        if (event.deltaY === 0 || this.wheelCooldown) return;

        this.wheelDelta += event.deltaY;
        if (Math.abs(this.wheelDelta) < WHEEL_THRESHOLD) return;

        const delta = this.wheelDelta > 0 ? 1 : -1;
        this.wheelDelta = 0;
        this.wheelCooldown = true;
        this.wheelCooldownTimer = window.setTimeout(() => {
          this.wheelCooldown = false;
          this.wheelCooldownTimer = undefined;
        }, WHEEL_COOLDOWN_MS);
        this.move(delta);
      },
      { passive: false },
    );
    document.addEventListener("keydown", (event) => {
      if (!this.isOpen) return;
      if (event.key === "Escape") {
        event.preventDefault();
        this.closeViewer();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        this.move(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        this.move(1);
      }
    });
    image.addEventListener("load", () => {
      this.elements.error.textContent = "";
      this.applyTransform();
    });
    image.addEventListener("error", () => {
      const current = this.images[this.index];
      if (current?.fallbackUrl && !this.fallbackAttempted && image.src !== current.fallbackUrl) {
        this.fallbackAttempted = true;
        image.src = current.fallbackUrl;
        return;
      }
      this.elements.error.textContent = "この画像を表示できません";
      this.updateInfo();
    });
    image.addEventListener("click", () => {
      if (this.didDrag) {
        this.didDrag = false;
        return;
      }
      this.zoom = this.zoom === 1 ? 2 : 1;
      if (this.zoom === 1) {
        this.panX = 0;
        this.panY = 0;
      }
      this.applyTransform();
    });
    image.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        this.zoom = Math.min(4, Math.max(1, this.zoom + (event.deltaY < 0 ? 0.25 : -0.25)));
        if (this.zoom === 1) {
          this.panX = 0;
          this.panY = 0;
        }
        this.applyTransform();
      },
      { passive: false },
    );
    viewer.addEventListener("pointerdown", (event) => {
      if (
        event.target instanceof Element &&
        (event.target.closest("button") || event.target.closest(".info-panel"))
      ) {
        return;
      }
      const captureTarget = event.target === image ? image : viewer;
      captureTarget.setPointerCapture(event.pointerId);
      this.didDrag = false;
      this.pointerStart = {
        x: event.clientX,
        y: event.clientY,
        panX: this.panX,
        panY: this.panY,
        onImage: event.target === image,
      };
      image.style.transition = "none";
      image.classList.toggle("dragging", this.zoom > 1 && this.pointerStart.onImage);
    });
    viewer.addEventListener("pointermove", (event) => {
      if (!this.pointerStart) return;
      const dx = event.clientX - this.pointerStart.x;
      const dy = event.clientY - this.pointerStart.y;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) this.didDrag = true;
      if (this.zoom > 1 && this.pointerStart.onImage) {
        this.panX = this.pointerStart.panX + dx;
        this.panY = this.pointerStart.panY + dy;
        this.applyTransform();
      } else {
        const dragY = dy > 0 && dy > Math.abs(dx) ? dy : 0;
        this.swipeOffsetY = dragY;
        this.applyTransform();
      }
    });
    const finishPointer = (event: PointerEvent) => {
      if (!this.pointerStart) return;
      const dx = event.clientX - this.pointerStart.x;
      const dy = event.clientY - this.pointerStart.y;
      const canceled = event.type === "pointercancel";
      const canCloseBySwipe = this.zoom === 1 || !this.pointerStart.onImage;
      if (!canceled && canCloseBySwipe && dy >= SWIPE_CLOSE_THRESHOLD && dy > Math.abs(dx)) {
        this.didDrag = true;
        this.closeViewer();
      } else if (!canceled && this.zoom === 1 && Math.abs(dx) >= 50 && Math.abs(dx) > dy) {
        this.move(dx < 0 ? 1 : -1);
        this.didDrag = true;
      }
      this.pointerStart = null;
      image.classList.remove("dragging");
      if (this.isOpen) this.resetSwipeVisuals(true);
    };
    viewer.addEventListener("pointerup", finishPointer);
    viewer.addEventListener("pointercancel", finishPointer);
  }

  private move(delta: number): void {
    if (!this.isOpen || this.images.length === 0) return;
    this.index = (this.index + delta + this.images.length) % this.images.length;
    this.resetZoom();
    this.render();
  }

  private resetWheelState(): void {
    if (this.wheelCooldownTimer !== undefined) window.clearTimeout(this.wheelCooldownTimer);
    this.wheelCooldownTimer = undefined;
    this.wheelDelta = 0;
    this.wheelCooldown = false;
  }

  private async toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement === this.host) {
        await document.exitFullscreen();
      } else {
        await this.host.requestFullscreen();
      }
    } catch {
      this.showToast("全画面表示を利用できません");
    }
  }

  private updateFullscreenButton(): void {
    const isFullscreen = document.fullscreenElement === this.host;
    const { fullscreen } = this.elements;
    const title = isFullscreen ? "全画面表示を終了" : "全画面表示";
    fullscreen.title = title;
    fullscreen.setAttribute("aria-label", title);
    fullscreen.replaceChildren();
    appendLucideIcon(fullscreen, isFullscreen ? Minimize2 : Maximize2, 18);
  }

  private updateFitButton(): void {
    const { fit } = this.elements;
    const title = this.fitMode ? "通常表示に戻す" : "画面にフィット";
    fit.title = title;
    fit.setAttribute("aria-label", title);
    fit.setAttribute("aria-pressed", String(this.fitMode));
  }

  private async restoreFitMode(): Promise<void> {
    try {
      const data = await getStorage<{ fitMode?: boolean }>("fitMode");
      this.fitMode = data.fitMode === true;
    } catch {
      this.fitMode = false;
    }
    this.updateFitButton();
  }

  private resetSwipeVisuals(animate: boolean): void {
    const { image } = this.elements;
    image.style.transition = animate ? "transform 160ms ease" : "none";
    this.swipeOffsetY = 0;
    this.applyTransform();
    if (animate) {
      window.setTimeout(() => {
        if (!this.pointerStart) image.style.transition = "";
      }, 160);
    } else {
      image.style.transition = "";
    }
  }

  private setHoverAnchor(target: HTMLImageElement): void {
    if (this.hoverTarget === target) return;
    this.clearHoverAnchor();
    this.previousAnchorName = target.style.getPropertyValue("anchor-name");
    this.previousAnchorPriority = target.style.getPropertyPriority("anchor-name");
    target.style.setProperty("anchor-name", HOVER_ANCHOR_NAME);
    this.hoverTarget = target;
  }

  private clearHoverAnchor(): void {
    if (!this.hoverTarget) return;
    if (this.previousAnchorName) {
      this.hoverTarget.style.setProperty(
        "anchor-name",
        this.previousAnchorName,
        this.previousAnchorPriority,
      );
    } else {
      this.hoverTarget.style.removeProperty("anchor-name");
    }
    this.hoverTarget = null;
    this.previousAnchorName = "";
    this.previousAnchorPriority = "";
  }

  private resetZoom(): void {
    this.zoom = 1;
    this.rotation = 0;
    this.panX = 0;
    this.panY = 0;
    this.swipeOffsetY = 0;
    this.didDrag = false;
  }

  private render(): void {
    const current = this.images[this.index];
    if (!current) return;
    this.elements.counter.textContent = `${this.index + 1} / ${this.images.length}`;
    this.elements.error.textContent = "";
    this.fallbackAttempted = false;
    this.elements.image.src = current.url;
    this.applyTransform();
  }

  private applyTransform(): void {
    const fitScale = this.getDisplayScale();
    this.elements.image.style.transform = `translate(${this.panX}px, ${this.panY + this.swipeOffsetY}px) rotate(${this.rotation}deg) scale(${this.zoom * fitScale})`;
    this.elements.image.classList.toggle("zoomed", this.zoom > 1);
    this.updateInfo(this.zoom * fitScale);
  }

  private getDisplayScale(): number {
    const { stage, image } = this.elements;
    const imageWidth = image.offsetWidth;
    const imageHeight = image.offsetHeight;
    const stageWidth = stage.clientWidth;
    const stageHeight = stage.clientHeight;
    if (!imageWidth || !imageHeight || !stageWidth || !stageHeight) return 1;

    const rotated = this.rotation % 180 !== 0;
    const displayedWidth = rotated ? imageHeight : imageWidth;
    const displayedHeight = rotated ? imageWidth : imageHeight;
    if (this.fitMode) {
      return Math.min(stageWidth / displayedWidth, stageHeight / displayedHeight);
    }

    const availableWidth = stageWidth * 0.92;
    const availableHeight = stageHeight * 0.82;
    const fitScale = Math.min(availableWidth / displayedWidth, availableHeight / displayedHeight);
    return rotated ? Math.min(1, fitScale) : 1;
  }

  private updateInfo(displayScale = this.zoom * this.getDisplayScale()): void {
    const current = this.images[this.index];
    if (current) this.elements.info.update(current, this.elements.image, displayScale);
  }
}

export function createImageViewer(): ImageViewer {
  return new ImageViewer();
}
