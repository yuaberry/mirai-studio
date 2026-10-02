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
  {
    name: '0002_app_kv',
    up: (db) => {
      db.exec(`
        CREATE TABLE app_kv (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
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
  {
    name: '0005_voice_tracks',
    up: (db) => {
      db.exec(`
        ALTER TABLE shots ADD COLUMN audio_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL;
      `)
    },
  },
  {
    name: '0006_media_library',
    up: (db) => {
      db.exec(`
        CREATE TABLE media_tracks (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          title TEXT NOT NULL,
          asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          tags TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX idx_media_kind ON media_tracks (kind, created_at);

        CREATE TABLE scene_media (
          scene_id TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
          media_id TEXT NOT NULL REFERENCES media_tracks(id) ON DELETE CASCADE,
          role TEXT NOT NULL DEFAULT 'BACKGROUND',
          volume REAL NOT NULL DEFAULT 1.0,
          PRIMARY KEY (scene_id, media_id)
        );
      `)
    },
  },
  {
    name: '0007_timeline_editing',
    up: (db) => {
      db.exec(`
        CREATE TABLE timeline_tracks (
          id TEXT PRIMARY KEY,
          scene_id TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
          kind TEXT NOT NULL,
          name TEXT NOT NULL,
          order_index INTEGER NOT NULL DEFAULT 0,
          muted INTEGER NOT NULL DEFAULT 0,
          solo INTEGER NOT NULL DEFAULT 0,
          volume REAL NOT NULL DEFAULT 1.0,
          pan REAL NOT NULL DEFAULT 0.0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX idx_timeline_tracks_scene ON timeline_tracks (scene_id, order_index);

        CREATE TABLE timeline_clips (
          id TEXT PRIMARY KEY,
          track_id TEXT NOT NULL REFERENCES timeline_tracks(id) ON DELETE CASCADE,
          source_type TEXT NOT NULL,
          source_id TEXT NOT NULL,
          label TEXT NOT NULL,
          start_sec REAL NOT NULL,
          duration_sec REAL NOT NULL,
          in_offset_sec REAL NOT NULL DEFAULT 0,
          volume REAL NOT NULL DEFAULT 1.0,
          opacity REAL NOT NULL DEFAULT 1.0,
          blend TEXT NOT NULL DEFAULT 'normal',
          effects TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX idx_timeline_clips_track ON timeline_clips (track_id, start_sec);

        CREATE TABLE timeline_markers (
          id TEXT PRIMARY KEY,
          scene_id TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
          at_sec REAL NOT NULL,
          label TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE INDEX idx_timeline_markers_scene ON timeline_markers (scene_id, at_sec);

        CREATE TABLE keyframes (
          id TEXT PRIMARY KEY,
          target_type TEXT NOT NULL,
          target_id TEXT NOT NULL,
          param TEXT NOT NULL,
          at_sec REAL NOT NULL,
          value REAL NOT NULL,
          easing TEXT NOT NULL DEFAULT 'linear',
          bezier TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (target_type, target_id, param, at_sec)
        );

        CREATE INDEX idx_keyframes_target ON keyframes (target_type, target_id, param);
      `)
    },
  },
  {
    name: '0008_production',
    up: (db) => {
      db.exec(`
        CREATE TABLE tasks (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT,
          status TEXT NOT NULL DEFAULT 'TODO',
          priority TEXT NOT NULL DEFAULT 'NORMAL',
          order_index INTEGER NOT NULL DEFAULT 0,
          link_type TEXT,
          link_id TEXT,
          assignee_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX idx_tasks_status ON tasks (status, order_index);

        CREATE TABLE crew_members (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          role TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE approval_events (
          id TEXT PRIMARY KEY,
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          from_status TEXT NOT NULL,
          to_status TEXT NOT NULL,
          note TEXT,
          actor_name TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE INDEX idx_approval_events_entity ON approval_events (entity_type, entity_id, created_at);

        CREATE TABLE entity_versions (
          id TEXT PRIMARY KEY,
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          version INTEGER NOT NULL,
          label TEXT,
          snapshot TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE (entity_type, entity_id, version)
        );

        CREATE INDEX idx_entity_versions_entity ON entity_versions (entity_type, entity_id, version);
      `)
    },
  },
  {
    name: '0009_subtitles_video',
    up: (db) => {
      db.exec(`
        CREATE TABLE subtitles (
          id TEXT PRIMARY KEY,
          scene_id TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
          start_sec REAL NOT NULL,
          end_sec REAL NOT NULL,
          text TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX idx_subtitles_scene ON subtitles (scene_id, start_sec);

        ALTER TABLE shots ADD COLUMN video_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL;
      `)
    },
  },
]
