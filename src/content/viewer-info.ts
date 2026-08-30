import { createElement as createLucideElement, Info } from "lucide";
import type { ViewerImage } from "./collector";

type InfoRow = {
  label: string;
  value: string;
};

const FORMAT_NAMES: Record<string, string> = {
  avif: "AVIF",
  bmp: "BMP",
  gif: "GIF",
  jpeg: "JPEG",
  jpg: "JPEG",
  png: "PNG",
  svg: "SVG",
  webp: "WebP",
};

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatUrl(value: string): string {
  return value || "-";
}

function getFileName(urlValue: string): string {
  if (!urlValue || urlValue.startsWith("data:")) return "-";
  try {
    const pathname = new URL(urlValue, document.baseURI).pathname;
    const name = pathname.split("/").pop() ?? "";
    return name ? decodeURIComponent(name) : "-";
  } catch {
    return "-";
  }
}

function getFormat(urlValue: string): string {
  if (!urlValue) return "-";
  const dataMatch = urlValue.match(/^data:image\/([^;,]+)/i);
  if (dataMatch?.[1]) {
    return FORMAT_NAMES[dataMatch[1].toLowerCase()] ?? dataMatch[1].toUpperCase();
  }

  try {
    const url = new URL(urlValue, document.baseURI);
    const queryFormat = url.searchParams.get("format") ?? url.searchParams.get("fm");
    if (queryFormat) {
      return FORMAT_NAMES[queryFormat.toLowerCase()] ?? queryFormat.toUpperCase();
    }
    const extension = url.pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
    return extension ? (FORMAT_NAMES[extension] ?? extension.toUpperCase()) : "-";
  } catch {
    return "-";
  }
}

function getResolution(image: HTMLImageElement): string {
  if (!image.naturalWidth || !image.naturalHeight) return "-";
  return `${image.naturalWidth} × ${image.naturalHeight} px`;
}

function getDisplaySize(image: HTMLImageElement): string {
  const rect = image.getBoundingClientRect();
  if (!rect.width || !rect.height) return "-";
  return `${formatNumber(rect.width)} × ${formatNumber(rect.height)} px`;
}

function getAspectRatio(image: HTMLImageElement): string {
  if (!image.naturalWidth || !image.naturalHeight) return "-";
  return `${formatNumber(image.naturalWidth / image.naturalHeight)}:1`;
}

function appendIcon(button: HTMLButtonElement): void {
  const svg = createLucideElement(Info, { width: 18, height: 18 });
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.style.display = "block";
  button.append(svg);
}

export class ImageInfoPanel {
  readonly element: HTMLDivElement;
  readonly button: HTMLButtonElement;
  private readonly values = new Map<string, HTMLSpanElement>();

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "info-menu";

    this.button = document.createElement("button");
    this.button.className = "info-button";
    this.button.type = "button";
    this.button.title = "画像情報";
    this.button.setAttribute("aria-label", "画像情報");
    appendIcon(this.button);

    const panel = document.createElement("div");
    panel.className = "info-panel";
    panel.setAttribute("role", "region");
    panel.setAttribute("aria-label", "画像情報");

    const rows: InfoRow[] = [
      { label: "ファイル名", value: "-" },
      { label: "表示URL", value: "-" },
      { label: "種類", value: "-" },
      { label: "形式", value: "-" },
      { label: "解像度", value: "-" },
      { label: "表示サイズ", value: "-" },
      { label: "縦横比", value: "-" },
      { label: "表示倍率", value: "-" },
      { label: "alt", value: "-" },
    ];

    for (const row of rows) {
      const item = document.createElement("div");
      item.className = "info-row";
      const label = document.createElement("span");
      label.className = "info-label";
      label.textContent = row.label;
      const value = document.createElement("span");
      value.className = "info-value";
      value.textContent = row.value;
      this.values.set(row.label, value);
      item.append(label, value);
      panel.append(item);
    }

    this.element.append(this.button, panel);
  }

  update(image: ViewerImage, displayedImage: HTMLImageElement, zoom: number): void {
    const displayedUrl = displayedImage.currentSrc || displayedImage.src || image.url;
    const rows: InfoRow[] = [
      { label: "ファイル名", value: getFileName(displayedUrl) },
      { label: "表示URL", value: formatUrl(displayedUrl) },
      { label: "種類", value: image.source === "background" ? "背景画像" : "画像" },
      { label: "形式", value: getFormat(displayedUrl) },
      { label: "解像度", value: getResolution(displayedImage) },
      { label: "表示サイズ", value: getDisplaySize(displayedImage) },
      { label: "縦横比", value: getAspectRatio(displayedImage) },
      { label: "表示倍率", value: `${formatNumber(zoom)}x` },
      { label: "alt", value: image.source === "img" ? image.alt || "-" : "-" },
    ];

    for (const row of rows) {
      const value = this.values.get(row.label);
      if (value) value.textContent = row.value;
    }
  }
}
