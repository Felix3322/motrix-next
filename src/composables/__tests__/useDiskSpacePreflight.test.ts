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

    expect(invoke).toHaveBeenCalledWith('get_available_disk_space', { path: '/downloads' })
    expect(failures).toEqual([{ item, requiredBytes: 600, availableBytes: 500, dir: '/downloads' }])
  })

  it('formats localized preflight details', () => {
    const t = (key: string, params?: Record<string, unknown>) => `${key}:${params?.required}/${params?.available}`
    expect(formatDiskSpaceError(t, 1024 * 1024, 512)).toBe('task.error-disk-full-detail:1.0 MB/512 B')
  })
})
