import type { GalleryImage } from "./collector";
import viewerStyle from "./viewer.css";

const HOST_ID = "image-viewer-extension-root";
const HOVER_HOST_ID = "image-viewer-extension-hover-root";
const HOVER_ANCHOR_NAME = "--image-viewer-target";

type ViewerElements = {
  viewer: HTMLDivElement;
  counter: HTMLSpanElement;
  image: HTMLImageElement;
  error: HTMLDivElement;
  prev: HTMLButtonElement;
  next: HTMLButtonElement;
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

function appendOpenIcon(button: HTMLButtonElement): void {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M8 16 16 8M10 8h6v6");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.8");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  button.append(svg);
}

export class ImageViewer {
  private readonly host: HTMLDivElement;
  private readonly hoverHost: HTMLDivElement;
  private readonly elements: ViewerElements;
  private images: GalleryImage[] = [];
  private index = 0;
  private zoom = 1;
  private panX = 0;
  private panY = 0;
  private pointerStart: { x: number; y: number; panX: number; panY: number } | null = null;
  private didDrag = false;
  private fallbackAttempted = false;
  private previousBodyOverflow = "";
  private hoverTarget: HTMLImageElement | null = null;
  private previousAnchorName = "";
  private previousAnchorPriority = "";
  private hoverHideTimer: number | undefined;
  private toastTimer: number | undefined;
  private isOpen = false;

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
    const close = makeButton("", "close", "閉じる");
    const counter = document.createElement("span");
    counter.className = "counter";
    topbar.append(close, counter);

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
    stage.append(prev, next);
    viewer.append(topbar, stage);

    const hover = makeButton("", "hover-button", "Image Viewerで開く (Alt + クリック)");
    appendOpenIcon(hover);
    hover.hidden = true;
    hover.addEventListener("pointerenter", () => this.cancelHoverHide());
    hover.addEventListener("pointerleave", () => this.scheduleHoverHide());

    viewerShadow.append(style, viewer);
    hoverShadow.append(hoverStyle, hover);
    this.host.style.display = "none";
    this.hoverHost.style.display = "none";
    this.elements = { viewer, counter, image, error, prev, next, close, hover };
    this.setupEvents();
  }

  get open(): boolean {
    return this.isOpen;
  }

  openViewer(images: GalleryImage[], initialIndex = 0): void {
    if (images.length === 0) return;
    if (!this.isOpen) {
      this.previousBodyOverflow = document.body?.style.overflow ?? "";
      if (document.body) document.body.style.overflow = "hidden";
    }
    this.images = images;
    this.index = ((initialIndex % images.length) + images.length) % images.length;
    this.isOpen = true;
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
    const { close, prev, next, image } = this.elements;
    close.addEventListener("click", () => this.closeViewer());
    prev.addEventListener("click", () => this.move(-1));
    next.addEventListener("click", () => this.move(1));
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
    image.addEventListener("pointerdown", (event) => {
      image.setPointerCapture(event.pointerId);
      this.didDrag = false;
      this.pointerStart = { x: event.clientX, y: event.clientY, panX: this.panX, panY: this.panY };
      image.classList.toggle("dragging", this.zoom > 1);
    });
    image.addEventListener("pointermove", (event) => {
      if (!this.pointerStart) return;
      const dx = event.clientX - this.pointerStart.x;
      const dy = event.clientY - this.pointerStart.y;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) this.didDrag = true;
      if (this.zoom > 1) {
        this.panX = this.pointerStart.panX + dx;
        this.panY = this.pointerStart.panY + dy;
        this.applyTransform();
      }
    });
    const finishPointer = (event: PointerEvent) => {
      if (!this.pointerStart) return;
      const dx = event.clientX - this.pointerStart.x;
      if (this.zoom === 1 && Math.abs(dx) >= 50) this.move(dx < 0 ? 1 : -1);
      this.pointerStart = null;
      image.classList.remove("dragging");
    };
    image.addEventListener("pointerup", finishPointer);
    image.addEventListener("pointercancel", finishPointer);
  }

  private move(delta: number): void {
    if (!this.isOpen || this.images.length === 0) return;
    this.index = (this.index + delta + this.images.length) % this.images.length;
    this.resetZoom();
    this.render();
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
    this.panX = 0;
    this.panY = 0;
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
    this.elements.image.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
    this.elements.image.classList.toggle("zoomed", this.zoom > 1);
  }
}

export function createImageViewer(): ImageViewer {
  return new ImageViewer();
}
