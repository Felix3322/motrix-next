/** @fileoverview Tests for torrent disk-space preflight helpers. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import type { Aria2EngineOptions, BatchItem } from '@shared/types'
import { checkTorrentDiskSpace, formatDiskSpaceError, isDiskSpaceError } from '../useDiskSpacePreflight'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

describe('useDiskSpacePreflight', () => {
  const options: Aria2EngineOptions = { dir: '/downloads', split: '16' }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('detects common disk-full error messages', () => {
    expect(isDiskSpaceError(new Error('There is not enough space on the disk.'))).toBe(true)
    expect(isDiskSpaceError({ Aria2: 'aria2 RPC error [9]: No space left on device' })).toBe(true)
    expect(isDiskSpaceError(new Error('network timeout'))).toBe(false)
  })

  it('reports a preflight failure when selected torrent files exceed available space', async () => {
    ;(invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
      path: '/downloads',
      checkedPath: '/downloads',
      availableBytes: 500,
      existingFileSizes: [],
    })
    const item = {
      id: '1',
      kind: 'torrent',
      source: 'large.torrent',
      payload: 'base64',
      displayName: 'large.torrent',
      status: 'pending',
      selectedFileIndices: [1, 3],
      torrentMeta: {
        infoHash: 'abc',
        files: [
          { idx: 1, path: 'a.bin', length: 400 },
          { idx: 2, path: 'b.bin', length: 900 },
          { idx: 3, path: 'c.bin', length: 200 },
        ],
      },
    } as BatchItem

    const failures = await checkTorrentDiskSpace([item], options)

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('get_available_disk_space', {
      path: '/downloads',
      relativePaths: ['a.bin', 'c.bin'],
    })
    expect(failures).toEqual([{ item, requiredBytes: 600, availableBytes: 500, dir: '/downloads' }])
  })

  it('tracks remaining free space across torrent batches with one IPC call', async () => {
    ;(invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
      path: '/downloads',
      checkedPath: '/downloads',
      availableBytes: 1000,
      existingFileSizes: [],
    })
    const first = {
      id: 'first',
      kind: 'torrent',
      source: 'first.torrent',
      payload: 'base64',
      displayName: 'first.torrent',
      status: 'pending',
      torrentMeta: { infoHash: 'abc', files: [{ idx: 1, path: 'first.bin', length: 700 }] },
    } as BatchItem
    const second = {
      id: 'second',
      kind: 'torrent',
      source: 'second.torrent',
      payload: 'base64',
      displayName: 'second.torrent',
      status: 'pending',
      torrentMeta: { infoHash: 'def', files: [{ idx: 1, path: 'second.bin', length: 500 }] },
    } as BatchItem

    const failures = await checkTorrentDiskSpace([first, second], options)

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(failures).toEqual([{ item: second, requiredBytes: 500, availableBytes: 300, dir: '/downloads' }])
  })

  it('subtracts existing target file sizes before checking required space', async () => {
    ;(invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
      path: '/downloads',
      checkedPath: '/downloads',
      availableBytes: 200,
      existingFileSizes: [{ relativePath: 'movie.mkv', sizeBytes: 900 }],
    })
    const item = {
      id: 'resume',
      kind: 'torrent',
      source: 'resume.torrent',
      payload: 'base64',
      displayName: 'resume.torrent',
      status: 'pending',
      torrentMeta: { infoHash: 'abc', files: [{ idx: 1, path: 'movie.mkv', length: 1000 }] },
    } as BatchItem

    const failures = await checkTorrentDiskSpace([item], options)

    expect(failures).toEqual([])
  })

  it('formats localized preflight details', () => {
    const t = (key: string, params?: Record<string, unknown>) => `${key}:${params?.required}/${params?.available}`
    expect(formatDiskSpaceError(t, 1024 * 1024, 512)).toBe('task.error-disk-full-detail:1.0 MB/512 B')
  })
})
