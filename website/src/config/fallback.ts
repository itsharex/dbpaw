import type { PlatformDownloads, ReleaseInfo } from '@/lib/github';

export const FALLBACK_RELEASE: ReleaseInfo = {
  version: 'v0.1.6',
  publishedAt: '2026-02-24T00:00:00.000Z',
  notesUrl: 'https://github.com/codeErrorSleep/dbpaw/releases/latest',
  assets: [
    {
      name: 'DbPaw-macOS.dmg',
      downloadUrl: 'https://github.com/codeErrorSleep/dbpaw/releases/latest'
    },
    {
      name: 'DbPaw-Windows.msi',
      downloadUrl: 'https://github.com/codeErrorSleep/dbpaw/releases/latest'
    },
    {
      name: 'DbPaw-Linux.AppImage',
      downloadUrl: 'https://github.com/codeErrorSleep/dbpaw/releases/latest'
    }
  ]
};

export const FALLBACK_DOWNLOADS: PlatformDownloads = {
  mac: 'https://github.com/codeErrorSleep/dbpaw/releases/latest',
  windows: 'https://github.com/codeErrorSleep/dbpaw/releases/latest',
  linux: 'https://github.com/codeErrorSleep/dbpaw/releases/latest'
};
