import { logInfo } from "../utils/logger";

const CONTEXT_MENU_ID = "image-viewer-open";

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

chrome.runtime.onInstalled.addListener((details) => {
  createContextMenu();
  if (details.reason === "install") {
    void logInfo("Image Viewerがインストールされました", "background", true);
  } else if (details.reason === "update") {
    void logInfo(
      `拡張機能がアップデートされました (v${details.previousVersion ?? "?"} → v${chrome.runtime.getManifest().version})`,
      "background",
      true,
    );
  }
});

chrome.runtime.onStartup.addListener(createContextMenu);
