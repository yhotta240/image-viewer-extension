export type ImageViewerSettings = {
  minImageSize: number;
  includeBackgroundImages: boolean;
  showHoverButton: boolean;
};

export type Settings = ImageViewerSettings & {
  [key: string]: unknown;
};

export const DEFAULT_SETTINGS: Settings = {
  minImageSize: 200,
  includeBackgroundImages: true,
  showHoverButton: true,
};
