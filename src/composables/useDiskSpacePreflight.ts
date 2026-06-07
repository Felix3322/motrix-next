/** @fileoverview Torrent disk-space preflight utilities for AddTask submissions. */
import { invoke } from '@tauri-apps/api/core'
import type { Aria2EngineOptions, BatchItem } from '@shared/types'
import { bytesToSize } from '@shared/utils/format'
import { getErrorMessage } from '@shared/utils/errorMessage'
import { logger } from '@shared/logger'

interface ExistingFileSize {
  relativePath: string
  sizeBytes: number
}

interface DiskSpaceInfo {
  path: string
  checkedPath: string
  availableBytes: number
  existingFileSizes?: ExistingFileSize[]
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

function selectedTorrentFiles(item: BatchItem): NonNullable<BatchItem['torrentMeta']>['files'] {
  const files = item.torrentMeta?.files ?? []
  if (files.length === 0) return []
  const selected = new Set(item.selectedFileIndices ?? files.map((file) => file.idx))
  return files.filter((file) => selected.has(file.idx) && typeof file.path === 'string' && file.length > 0)
}

function selectedTorrentBytes(item: BatchItem, existingSizes: ReadonlyMap<string, number>): number | null {
  const selectedFiles = selectedTorrentFiles(item)
  if (selectedFiles.length === 0) return null
  return selectedFiles.reduce((total, file) => {
    const existingBytes = existingSizes.get(file.path) ?? 0
    return total + Math.max(file.length - existingBytes, 0)
  }, 0)
}

function torrentFilePaths(items: BatchItem[]): string[] {
  const uniquePaths = new Set<string>()
  for (const item of items) {
    if (item.kind !== 'torrent' || (item.status !== 'pending' && item.status !== 'failed')) continue
    for (const file of selectedTorrentFiles(item)) {
      uniquePaths.add(file.path)
    }
  }
  return [...uniquePaths]
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

  const relativePaths = torrentFilePaths(items)
  if (relativePaths.length === 0) return failures

  let info: DiskSpaceInfo
  try {
    info = await invoke<DiskSpaceInfo>('get_available_disk_space', {
      path: dir,
      relativePaths,
    })
  } catch (error) {
    logger.warn('DiskSpacePreflight', getErrorMessage(error))
    return failures
  }

  const existingSizes = new Map((info.existingFileSizes ?? []).map((file) => [file.relativePath, file.sizeBytes]))
  let remainingBytes = info.availableBytes

  for (const item of items) {
    if (item.kind !== 'torrent' || (item.status !== 'pending' && item.status !== 'failed')) continue
    const requiredBytes = selectedTorrentBytes(item, existingSizes)
    if (requiredBytes === null || requiredBytes <= 0) continue

    if (remainingBytes < requiredBytes) {
      failures.push({ item, requiredBytes, availableBytes: remainingBytes, dir: info.path })
      continue
    }
    remainingBytes -= requiredBytes
  }

  return failures
}
