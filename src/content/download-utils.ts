const INVALID_FILENAME_CHARACTERS = /[<>:"/\\|?*]/g;
const MIME_EXTENSIONS: Record<string, string> = {
  "image/avif": ".avif",
  "image/bmp": ".bmp",
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/svg+xml": ".svg",
  "image/webp": ".webp",
};

function sanitizeFilename(value: string, fallback: string): string {
  const withoutControlCharacters = Array.from(value, (character) =>
    character.charCodeAt(0) < 32 ? "_" : character,
  ).join("");
  const sanitized = withoutControlCharacters
    .replace(INVALID_FILENAME_CHARACTERS, "_")
    .replace(/[. ]+$/, "")
    .trim();
  return sanitized || fallback;
}

function hasExtension(value: string): boolean {
  return /\.[a-z0-9]{1,8}$/i.test(value);
}

export function getDownloadFilename(url: string, fallback: string, blob?: Blob): string {
  let filename = fallback;
  try {
    const parsed = new URL(url, document.baseURI);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      const segment = decodeURIComponent(parsed.pathname.split("/").pop() ?? "").trim();
      if (segment) filename = segment;
    }
  } catch {
    // URLからファイル名を取得できない場合はfallbackを使う
  }

  filename = sanitizeFilename(filename, fallback);
  if (!hasExtension(filename) && blob?.type && MIME_EXTENSIONS[blob.type]) {
    filename += MIME_EXTENSIONS[blob.type];
  }
  return filename;
}

export function getUniqueFilename(filename: string, used: Set<string>): string {
  if (!used.has(filename)) {
    used.add(filename);
    return filename;
  }

  const extensionIndex = filename.lastIndexOf(".");
  const basename = extensionIndex > 0 ? filename.slice(0, extensionIndex) : filename;
  const extension = extensionIndex > 0 ? filename.slice(extensionIndex) : "";
  let suffix = 2;
  let candidate = `${basename}-${suffix}${extension}`;
  while (used.has(candidate)) {
    suffix += 1;
    candidate = `${basename}-${suffix}${extension}`;
  }
  used.add(candidate);
  return candidate;
}

export function getZipFilename(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const timestamp = [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
  return `image-viewer-${timestamp}.zip`;
}

export function saveBlob(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  saveUrl(objectUrl, filename);
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

export function saveUrl(url: string, filename: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  link.style.display = "none";
  (document.body ?? document.documentElement).append(link);
  link.click();
  link.remove();
}
