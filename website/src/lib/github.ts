export type ReleaseAsset = {
  name: string;
  downloadUrl: string;
};

export type ReleaseInfo = {
  version: string;
  publishedAt: string;
  assets: ReleaseAsset[];
  notesUrl: string;
};

export type PlatformDownloads = {
  mac?: string;
  windows?: string;
  linux?: string;
};

type GitHubReleaseResponse = {
  tag_name: string;
  published_at: string;
  html_url: string;
  assets: Array<{ name: string; browser_download_url: string }>;
};

export async function fetchLatestRelease(
  repo: 'codeErrorSleep/dbpaw'
): Promise<ReleaseInfo> {
  const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'dbpaw-website'
    }
  });

  if (!response.ok) {
    throw new Error(`GitHub API failed with status ${response.status}`);
  }

  const data = (await response.json()) as GitHubReleaseResponse;

  return {
    version: data.tag_name,
    publishedAt: data.published_at,
    notesUrl: data.html_url,
    assets: data.assets.map((asset) => ({
      name: asset.name,
      downloadUrl: asset.browser_download_url
    }))
  };
}
