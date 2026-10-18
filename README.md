# Image Viewer

現在開いているWebページの画像を集め，ビューアでまとめて閲覧・保存できるChrome拡張機能です．

## 主な機能

- ページ内の画像をビューアで1枚ずつ表示
- 左右キー・ボタン・スワイプで画像を切り替え
- クリック・ホイール・ドラッグで拡大・移動
- 画像上のボタン・Alt + クリック・右クリックメニューから表示
- 画像のダウンロードと共有
- ギャラリー表示で画像を一覧確認

## インストール



[Image Viewer - Chrome Web Store](https://chromewebstore.google.com/detail/mlenbajimihbknnalkghalcleledbpoe?utm_source=item-share-cb)

### 手動インストール

手順

1. このリポジトリをクローン

   ```bash
   git clone https://github.com/yhotta240/image-viewer-extension.git
   cd image-viewer-extension
   ```

2. 依存関係をインストール

   ```bash
   npm install
   ```

3. ビルド

   ```bash
   npm run build
   ```

4. Chrome に読み込む
   - Chrome で `chrome://extensions/` を開く
   - 「デベロッパーモード」をオンにする
   - 「パッケージ化されていない拡張機能を読み込む」をクリック
   - `dist/` ディレクトリを選択

## 使い方

- 画像にマウスを重ねて表示されるボタンをクリック
- 画像上で Alt + クリック
- 画像を右クリックして「Image Viewerで開く」を選択

詳しい導入手順，設定，操作方法は，[チュートリアル](docs/tutorial.md)を確認してください．

## ライセンス

MIT License

## 作者

yhotta240
