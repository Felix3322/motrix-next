/** @fileoverview Guards frontend DB schema defaults against stale SQL migration versions. */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CURRENT_DB_SCHEMA_VERSION, DEFAULT_APP_CONFIG } from '@shared/constants'

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')

function latestRegisteredSqlMigrationVersion(): number {
  const libSource = fs.readFileSync(path.join(REPO_ROOT, 'src-tauri', 'src', 'lib.rs'), 'utf-8')
  const versions = Array.from(libSource.matchAll(/tauri_plugin_sql::Migration\s*\{\s*version:\s*(\d+)/g)).map((match) =>
    Number(match[1]),
  )
  return Math.max(...versions)
}

describe('DB schema version defaults', () => {
  it('matches the latest registered SQL migration version', () => {
    expect(CURRENT_DB_SCHEMA_VERSION).toBe(latestRegisteredSqlMigrationVersion())
  })

  it('stamps fresh installs with the current DB schema version', () => {
    expect(DEFAULT_APP_CONFIG.dbSchemaVersion).toBe(CURRENT_DB_SCHEMA_VERSION)
  })
})
