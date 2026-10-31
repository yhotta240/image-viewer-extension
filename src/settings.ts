export type ImageViewerSettings = {
  minImageSize: number;
  includeBackgroundImages: boolean;
  showHoverButton: boolean;
  initialView: "preview" | "gallery";
  scrollToImageOnClose: boolean;
};

export type Settings = ImageViewerSettings & {
  [key: string]: unknown;
};

export const DEFAULT_SETTINGS: Settings = {
  minImageSize: 200,
  includeBackgroundImages: true,
  showHoverButton: true,
  initialView: "preview",
  scrollToImageOnClose: false,
};
