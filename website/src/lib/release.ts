import { FALLBACK_DOWNLOADS, FALLBACK_RELEASE } from '@/config/fallback';
import { REPO } from '@/config/site';
import { mapAssetsToPlatforms } from '@/lib/download-map';
import { fetchLatestRelease, type PlatformDownloads, type ReleaseInfo } from '@/lib/github';

export type ReleaseSnapshot = {
  release: ReleaseInfo;
  downloads: PlatformDownloads;
  source: 'github' | 'fallback';
};

export async function getReleaseSnapshot(): Promise<ReleaseSnapshot> {
  try {
    const release = await fetchLatestRelease(REPO);
    const mapped = mapAssetsToPlatforms(release.assets);

    return {
      release,
      downloads: {
        mac: mapped.mac ?? FALLBACK_DOWNLOADS.mac,
        windows: mapped.windows ?? FALLBACK_DOWNLOADS.windows,
        linux: mapped.linux ?? FALLBACK_DOWNLOADS.linux
      },
      source: 'github'
    };
  } catch {
    return {
      release: FALLBACK_RELEASE,
      downloads: FALLBACK_DOWNLOADS,
      source: 'fallback'
    };
  }
}
