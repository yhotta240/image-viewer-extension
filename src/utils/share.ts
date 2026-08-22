export type SharePlatform = "twitter" | "facebook" | "copy";

export interface ShareConfig {
  title: string;
  url: string;
  text?: string;
}

export function getShareUrl(platform: SharePlatform, config: ShareConfig): string | null {
  const encodedUrl = encodeURIComponent(config.url);
  const encodedText = encodeURIComponent(config.text || config.title);

  switch (platform) {
    case "twitter":
      return `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`;
    case "facebook":
      return `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`;
    case "copy":
      return null;
  }
}

export async function executeShare(platform: SharePlatform, config: ShareConfig): Promise<boolean> {
  if (platform === "copy") {
    try {
      await navigator.clipboard.writeText(config.url);
      return true;
    } catch (error) {
      console.error("Failed to copy to clipboard", error);
      return false;
    }
  }

  const shareUrl = getShareUrl(platform, config);
  if (!shareUrl) return false;

  window.open(shareUrl, "_blank", "width=600,height=400");
  return true;
}
