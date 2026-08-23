import { logInfo } from "../utils/logger";

const CONTEXT_MENU_ID = "image-viewer-open";

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

async function fetchImage(url: string): Promise<{ ok: boolean; url?: string; dataUrl?: string }> {
  try {
    const response = await fetch(url);
    if (!response.ok) return { ok: false };
    const contentType = response.headers.get("content-type") || "application/octet-stream";
    const data = encodeBase64(new Uint8Array(await response.arrayBuffer()));
    return { ok: true, url, dataUrl: `data:${contentType};base64,${data}` };
  } catch {
    return { ok: false };
  }
}

function createContextMenu(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: "Image Viewerで開く",
      contexts: ["image"],
    });
  });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const tabId = tab?.id;
  if (info.menuItemId !== CONTEXT_MENU_ID || tabId === undefined) return;
  chrome.tabs.sendMessage(tabId, { type: "OPEN_VIEWER", sourceUrl: info.srcUrl }).catch(() => {
    // chrome://ページやWeb Storeなど、content scriptが動作しないページでは何もしない
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "FETCH_IMAGE") {
    void fetchImage(message.url).then(sendResponse);
    return true;
  }
  if (message?.type !== "DOWNLOAD_IMAGE") return;
  void chrome.downloads
    .download({ url: message.url, filename: message.filename, saveAs: false })
    .then(() => sendResponse({ ok: true }))
    .catch(() => sendResponse({ ok: false }));
  return true;
});

chrome.runtime.onInstalled.addListener((details) => {
  createContextMenu();
  if (details.reason === "install") {
    void logInfo("Image Viewerがインストールされました", "background");
  } else if (details.reason === "update") {
    void logInfo(
      `拡張機能がアップデートされました (v${details.previousVersion ?? "?"} → v${chrome.runtime.getManifest().version})`,
      "background",
    );
  }
});

chrome.runtime.onStartup.addListener(createContextMenu);
