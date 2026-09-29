/**
 * SQL migrations for the App DB (global) and Project DB (per project).
 * Rule: NEVER edit an existing migration — always append a new one.
 */
import type { Migration } from './migrator'

// ---------------------------------------------------------------------------
// App DB — project registry, settings, encrypted credentials
// ---------------------------------------------------------------------------
export const APP_DB_MIGRATIONS: Migration[] = [
  {
    name: '0001_init',
    up: (db) => {
      db.exec(`
        CREATE TABLE project_registry (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          path TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL DEFAULT 'ACTIVE',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          last_opened_at TEXT,
          app_version TEXT NOT NULL
        );

        CREATE TABLE settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE credentials (
          key TEXT PRIMARY KEY,
          data BLOB NOT NULL,
          secure INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `)
    },
  },
]

// ---------------------------------------------------------------------------
// Project DB — job queue, generic KV, creative core, prompt library
// ---------------------------------------------------------------------------
export const PROJECT_DB_MIGRATIONS: Migration[] = [
  {
    name: '0001_init',
    up: (db) => {
      db.exec(`
        CREATE TABLE job_records (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          status TEXT NOT NULL,
          priority INTEGER NOT NULL DEFAULT 5,
          payload TEXT,
          result TEXT,
          error TEXT,
          progress INTEGER,
          attempts INTEGER NOT NULL DEFAULT 0,
          max_attempts INTEGER NOT NULL DEFAULT 3,
          scheduled_at TEXT NOT NULL,
          started_at TEXT,
          finished_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          interrupted INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX idx_job_records_pick
          ON job_records (status, priority DESC, scheduled_at ASC);

        CREATE TABLE kv_store (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `)
    },
  },
  {
    name: '0002_creative_core',
    up: (db) => {
      db.exec(`
        CREATE TABLE characters (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'SUPPORTING',
          age TEXT,
          personality TEXT,
          appearance TEXT,
          voice TEXT,
          bio TEXT,
          goals TEXT,
          fears TEXT,
          notes TEXT,
          status TEXT NOT NULL DEFAULT 'DRAFT',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE locations (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          climate TEXT,
          architecture TEXT,
          notes TEXT,
          status TEXT NOT NULL DEFAULT 'DRAFT',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE episodes (
          id TEXT PRIMARY KEY,
          season INTEGER NOT NULL DEFAULT 1,
          number INTEGER NOT NULL,
          title TEXT NOT NULL,
          synopsis TEXT,
          status TEXT NOT NULL DEFAULT 'TODO',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (season, number)
        );

        CREATE TABLE scenes (
          id TEXT PRIMARY KEY,
          episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
          order_index INTEGER NOT NULL DEFAULT 0,
          title TEXT NOT NULL,
          location_id TEXT REFERENCES locations(id) ON DELETE SET NULL,
          time_of_day TEXT NOT NULL DEFAULT 'UNSPECIFIED',
          synopsis TEXT,
          screenplay TEXT,
          status TEXT NOT NULL DEFAULT 'TODO',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX idx_scenes_episode ON scenes (episode_id, order_index);

        CREATE TABLE scene_characters (
          scene_id TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
          character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
          PRIMARY KEY (scene_id, character_id)
        );
      `)
    },
  },
  {
    name: '0003_prompt_library',
    up: (db) => {
      db.exec(`
        CREATE TABLE prompts (
          id TEXT PRIMARY KEY,
          category TEXT NOT NULL,
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          tags TEXT,
          builtin INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX idx_prompts_category ON prompts (category, title);
      `)
    },
  },
  {
    name: '0004_storyboard',
    up: (db) => {
      db.exec(`
        CREATE TABLE assets (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          relative_path TEXT NOT NULL,
          original_name TEXT NOT NULL,
          mime TEXT NOT NULL,
          bytes INTEGER NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE shots (
          id TEXT PRIMARY KEY,
          scene_id TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
          order_index INTEGER NOT NULL DEFAULT 0,
          title TEXT NOT NULL,
          shot_type TEXT NOT NULL DEFAULT 'MEDIUM',
          lens TEXT NOT NULL DEFAULT '50mm',
          camera_movement TEXT NOT NULL DEFAULT 'STATIC',
          duration_seconds REAL NOT NULL DEFAULT 3,
          dialogue TEXT,
          notes TEXT,
          frame_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
          status TEXT NOT NULL DEFAULT 'TODO',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX idx_shots_scene ON shots (scene_id, order_index);
      `)
    },
  },
]
