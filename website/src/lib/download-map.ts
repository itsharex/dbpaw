import type { PlatformDownloads, ReleaseAsset } from '@/lib/github';

const byPriority = {
  mac: ['.dmg', '.app.tar.gz'],
  windows: ['.msi', '.exe'],
  linux: ['.appimage', '.deb', '.rpm']
} as const;

function findAsset(assets: ReleaseAsset[], extensions: readonly string[]): string | undefined {
  for (const ext of extensions) {
    const match = assets.find((asset) => asset.name.toLowerCase().endsWith(ext));
    if (match) {
      return match.downloadUrl;
    }
  }
  return undefined;
}

export function mapAssetsToPlatforms(assets: ReleaseAsset[]): PlatformDownloads {
  return {
    mac: findAsset(assets, byPriority.mac),
    windows: findAsset(assets, byPriority.windows),
    linux: findAsset(assets, byPriority.linux)
  };
}
