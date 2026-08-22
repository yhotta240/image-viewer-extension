import { executeShare, type ShareConfig, type SharePlatform } from "../../utils/share";

/**
 * シェア機能の初期化
 */
export function initShareMenu(onShare?: (platform: SharePlatform, success: boolean) => void): void {
  const moreMenu = document.getElementById("more-menu");
  const shareOptions = document.querySelectorAll(".share-option");

  if (!moreMenu) return;

  // 各シェアオプションのクリック処理
  shareOptions.forEach((option) => {
    option.addEventListener("click", async () => {
      const platform = (option as HTMLElement).dataset.share as SharePlatform;
      if (!platform) return;

      // Chrome拡張機能のストアページURLを取得
      const extensionId = chrome.runtime.id;
      const manifest = chrome.runtime.getManifest();
      const storeUrl = `https://chrome.google.com/webstore/detail/${extensionId}?utm_source=item-share-cb`;

      const config: ShareConfig = {
        title: manifest.name,
        url: storeUrl,
        text: `${manifest.name} - ${manifest.description || "Chrome拡張機能"}`,
      };

      const success = await executeShare(platform, config);

      // コピー成功時にアイコンを一時的に変更
      if (platform === "copy" && success) {
        const iconElement = option.querySelector("i");
        if (iconElement) {
          iconElement.classList.remove("bi-clipboard");
          iconElement.classList.add("bi-check2");
          setTimeout(() => {
            iconElement.classList.remove("bi-check2");
            iconElement.classList.add("bi-clipboard");
          }, 2000);
        }
      }

      // コールバック実行
      onShare?.(platform, success);
    });
  });
}
