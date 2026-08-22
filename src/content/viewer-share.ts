import { createElement as createLucideElement, type IconNode, Share2 } from "lucide";
import { executeShare, type ShareConfig, type SharePlatform } from "../utils/share";

type ShareTarget = "image" | "page";

type ViewerShareOptions = {
  getImageUrl: () => string;
  getPageUrl: () => string;
  showToast: (message: string) => void;
  logFailure: (message: string, detail?: string) => void;
};

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

export class ViewerShareMenu {
  readonly element: HTMLDivElement;

  private readonly button: HTMLButtonElement;
  private readonly menu: HTMLDivElement;
  private readonly imageTarget: HTMLButtonElement;
  private readonly pageTarget: HTMLButtonElement;
  private readonly twitter: HTMLButtonElement;
  private readonly facebook: HTMLButtonElement;
  private readonly copy: HTMLButtonElement;
  private readonly options: ViewerShareOptions;
  private target: ShareTarget = "image";

  constructor(options: ViewerShareOptions) {
    this.options = options;

    const container = document.createElement("div");
    container.className = "share-container";

    this.button = makeButton("", "share-button", "共有");
    this.button.setAttribute("aria-haspopup", "menu");
    this.button.setAttribute("aria-expanded", "false");
    appendLucideIcon(this.button, Share2, 18);

    this.menu = document.createElement("div");
    this.menu.className = "share-menu";
    this.menu.hidden = true;
    this.menu.setAttribute("role", "menu");

    const label = document.createElement("div");
    label.className = "share-label";
    label.textContent = "共有対象";

    const targets = document.createElement("div");
    targets.className = "share-targets";
    this.imageTarget = makeButton("画像URL", "share-target", "画像URLを共有");
    this.imageTarget.setAttribute("role", "menuitemradio");
    this.pageTarget = makeButton("ページURL", "share-target", "元ページURLを共有");
    this.pageTarget.setAttribute("role", "menuitemradio");
    targets.append(this.imageTarget, this.pageTarget);

    this.twitter = makeButton("X（Twitter）", "share-option", "X（Twitter）で共有");
    this.twitter.setAttribute("role", "menuitem");
    this.facebook = makeButton("Facebook", "share-option", "Facebookで共有");
    this.facebook.setAttribute("role", "menuitem");
    this.copy = makeButton("画像URLをコピー", "share-option", "画像URLをコピー");
    this.copy.setAttribute("role", "menuitem");

    this.menu.append(label, targets, this.twitter, this.facebook, this.copy);
    container.append(this.button, this.menu);
    this.element = container;

    this.button.addEventListener("click", (event) => {
      event.stopPropagation();
      this.setMenuOpen(this.menu.hidden);
    });
    this.imageTarget.addEventListener("click", () => this.setTarget("image"));
    this.pageTarget.addEventListener("click", () => this.setTarget("page"));
    this.twitter.addEventListener("click", () => void this.handleShare("twitter"));
    this.facebook.addEventListener("click", () => void this.handleShare("facebook"));
    this.copy.addEventListener("click", () => void this.handleShare("copy"));
    this.menu.addEventListener("click", (event) => event.stopPropagation());

    this.update();
  }

  reset(): void {
    this.target = "image";
    this.close();
    this.update();
  }

  update(): void {
    const isImageTarget = this.target === "image";
    this.imageTarget.setAttribute("aria-pressed", String(isImageTarget));
    this.pageTarget.setAttribute("aria-pressed", String(!isImageTarget));
    this.imageTarget.setAttribute("aria-checked", String(isImageTarget));
    this.pageTarget.setAttribute("aria-checked", String(!isImageTarget));

    const copyLabel = isImageTarget ? "画像URLをコピー" : "ページURLをコピー";
    this.copy.textContent = copyLabel;
    this.copy.title = copyLabel;
    this.copy.setAttribute("aria-label", copyLabel);

    const disabled = this.getShareConfig() === null;
    this.twitter.disabled = disabled;
    this.facebook.disabled = disabled;
    this.copy.disabled = disabled;
  }

  close(): void {
    this.setMenuOpen(false);
  }

  containsTarget(target: EventTarget | null): boolean {
    return target instanceof Node && this.element.contains(target);
  }

  handleEscape(): boolean {
    if (this.menu.hidden) return false;
    this.close();
    return true;
  }

  private setMenuOpen(open: boolean): void {
    this.menu.hidden = !open;
    this.button.setAttribute("aria-expanded", String(open));
  }

  private setTarget(target: ShareTarget): void {
    this.target = target;
    this.update();
  }

  private getShareConfig(): ShareConfig | null {
    const url = this.target === "image" ? this.options.getImageUrl() : this.options.getPageUrl();
    if (!url) return null;

    const title = document.title || "Image Viewer";
    return { title, url, text: title };
  }

  private async handleShare(platform: SharePlatform): Promise<void> {
    const config = this.getShareConfig();
    if (!config) {
      this.options.showToast("共有するURLを取得できませんでした");
      this.options.logFailure("共有するURLを取得できませんでした");
      return;
    }

    const success = await executeShare(platform, config);
    this.close();
    if (!success) {
      this.options.showToast("共有できませんでした");
      this.options.logFailure("共有に失敗しました", config.url);
      return;
    }

    if (platform === "copy") {
      const label = this.target === "image" ? "画像URL" : "ページURL";
      this.options.showToast(`${label}をコピーしました`);
    }
  }
}
