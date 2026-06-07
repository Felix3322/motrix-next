/** @fileoverview Torrent disk-space preflight utilities for AddTask submissions. */
import { invoke } from '@tauri-apps/api/core'
import type { Aria2EngineOptions, BatchItem } from '@shared/types'
import { bytesToSize } from '@shared/utils/format'
import { getErrorMessage } from '@shared/utils/errorMessage'
import { logger } from '@shared/logger'

interface DiskSpaceInfo {
  path: string
  checkedPath: string
  availableBytes: number
}

export interface DiskSpaceFailure {
  item: BatchItem
  requiredBytes: number
  availableBytes: number
  dir: string
}

const DISK_FULL_PATTERNS = [
  /errorCode\s*=\s*9/i,
  /\berror\s*\[9\]/i,
  /not enough (?:free )?space/i,
  /no space left/i,
  /disk(?: is)? full/i,
  /insufficient disk space/i,
  /enospc/i,
  /ERROR_DISK_FULL/i,
  /err(?:or)?\s*(?:num(?:ber)?|no)?\s*=?\s*112/i,
]

function selectedTorrentBytes(item: BatchItem): number | null {
  const files = item.torrentMeta?.files
  if (!files || files.length === 0) return null
  const selected = new Set(item.selectedFileIndices ?? files.map((file) => file.idx))
  return files.reduce((total, file) => (selected.has(file.idx) ? total + file.length : total), 0)
}

export function isDiskSpaceError(error: unknown): boolean {
  const message = getErrorMessage(error)
  return DISK_FULL_PATTERNS.some((pattern) => pattern.test(message))
}

export function formatDiskSpaceError(
  t: (key: string, params?: Record<string, unknown>) => string,
  requiredBytes: number,
  availableBytes: number,
): string {
  return t('task.error-disk-full-detail', {
    required: bytesToSize(requiredBytes),
    available: bytesToSize(availableBytes),
  })
}

export async function checkTorrentDiskSpace(
  items: BatchItem[],
  options: Aria2EngineOptions,
): Promise<DiskSpaceFailure[]> {
  const failures: DiskSpaceFailure[] = []
  const dir = typeof options.dir === 'string' ? options.dir.trim() : ''
  if (!dir) return failures

  for (const item of items) {
    if (item.kind !== 'torrent' || (item.status !== 'pending' && item.status !== 'failed')) continue
    const requiredBytes = selectedTorrentBytes(item)
    if (requiredBytes === null || requiredBytes <= 0) continue

    try {
      const info = await invoke<DiskSpaceInfo>('get_available_disk_space', { path: dir })
      if (info.availableBytes < requiredBytes) {
        failures.push({ item, requiredBytes, availableBytes: info.availableBytes, dir: info.path })
      }
    } catch (error) {
      logger.warn('DiskSpacePreflight', getErrorMessage(error))
    }
  }

  return failures
}
