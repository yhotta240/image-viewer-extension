export type SharePlatform = "twitter" | "facebook" | "copy";

export interface ShareConfig {
  title: string;
  url: string;
  text?: string;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall back to the document command for HTTP pages and restricted contexts.
  }

  const container = document.body ?? document.documentElement;
  if (!container) return false;

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  textarea.style.left = "-9999px";
  container.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
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
    const success = await copyToClipboard(config.url);
    if (!success) console.error("Failed to copy to clipboard");
    return success;
  }

  const shareUrl = getShareUrl(platform, config);
  if (!shareUrl) return false;

  window.open(shareUrl, "_blank", "width=600,height=400");
  return true;
}
