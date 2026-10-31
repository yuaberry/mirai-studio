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
  {
    name: '0003_ai_usage',
    up: (db) => {
      db.exec(`
        CREATE TABLE ai_usage (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ts TEXT NOT NULL,
          kind TEXT NOT NULL,
          provider TEXT,
          model TEXT,
          prompt_tokens INTEGER NOT NULL DEFAULT 0,
          completion_tokens INTEGER NOT NULL DEFAULT 0,
          duration_ms INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'OK',
          error TEXT
        );
        CREATE INDEX idx_usage_ts ON ai_usage (ts);
      `)
    },
  },
  {
    name: '0004_derived_works',
    up: (db) => {
      db.exec(`
        CREATE TABLE derived_works (
          id TEXT PRIMARY KEY,
          parent_project_id TEXT NOT NULL,
          child_project_id TEXT NOT NULL,
          kind TEXT NOT NULL DEFAULT 'ADAPTATION',
          notes TEXT,
          created_at TEXT NOT NULL,
          UNIQUE (parent_project_id, child_project_id)
        );
        CREATE INDEX idx_dw_parent ON derived_works (parent_project_id);
        CREATE INDEX idx_dw_child ON derived_works (child_project_id);
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
  {
    name: '0010_blend_files',
    up: (db) => {
      db.exec(`
        ALTER TABLE shots ADD COLUMN blend_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL;
      `)
    },
  },
  {
    name: '0012_relationships_costumes',
    up: (db) => {
      db.exec(`
        CREATE TABLE character_relationships (
          id TEXT PRIMARY KEY,
          from_character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
          to_character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
          kind TEXT NOT NULL DEFAULT 'UNKNOWN',
          notes TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX idx_rel_from ON character_relationships (from_character_id);
        CREATE INDEX idx_rel_to ON character_relationships (to_character_id);

        CREATE TABLE character_costumes (
          id TEXT PRIMARY KEY,
          character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          description TEXT,
          occasion TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX idx_costume_char ON character_costumes (character_id);
      `)
    },
  },
  {
    name: '0013_project_memory_fts',
    up: (db) => {
      db.exec(`
        CREATE VIRTUAL TABLE project_memory USING fts5(
          entity_type,
          entity_id,
          title,
          body,
          tokenize = 'unicode61 remove_diacritics 2'
        );
        CREATE TRIGGER scenes_ai AFTER INSERT ON scenes BEGIN
          INSERT INTO project_memory (entity_type, entity_id, title, body)
          VALUES ('SCENE', new.id, new.title, coalesce(new.synopsis, '') || ' ' || coalesce(new.screenplay, ''));
        END;
        CREATE TRIGGER scenes_au AFTER UPDATE OF title, synopsis, screenplay ON scenes BEGIN
          DELETE FROM project_memory WHERE entity_type = 'SCENE' AND entity_id = new.id;
          INSERT INTO project_memory (entity_type, entity_id, title, body)
          VALUES ('SCENE', new.id, new.title, coalesce(new.synopsis, '') || ' ' || coalesce(new.screenplay, ''));
        END;
        CREATE TRIGGER scenes_ad AFTER DELETE ON scenes BEGIN
          DELETE FROM project_memory WHERE entity_type = 'SCENE' AND entity_id = old.id;
        END;
        CREATE TRIGGER characters_ai AFTER INSERT ON characters BEGIN
          INSERT INTO project_memory (entity_type, entity_id, title, body)
          VALUES ('CHARACTER', new.id, new.name, coalesce(new.appearance, '') || ' ' || coalesce(new.personality, '') || ' ' || coalesce(new.bio, ''));
        END;
        CREATE TRIGGER characters_au AFTER UPDATE OF name, appearance, personality, bio ON characters BEGIN
          DELETE FROM project_memory WHERE entity_type = 'CHARACTER' AND entity_id = new.id;
          INSERT INTO project_memory (entity_type, entity_id, title, body)
          VALUES ('CHARACTER', new.id, new.name, coalesce(new.appearance, '') || ' ' || coalesce(new.personality, '') || ' ' || coalesce(new.bio, ''));
        END;
        CREATE TRIGGER characters_ad AFTER DELETE ON characters BEGIN
          DELETE FROM project_memory WHERE entity_type = 'CHARACTER' AND entity_id = old.id;
        END;
      `)
    },
  },
  {
    name: '0011_task_due_dates',
    up: (db) => {
      db.exec(`
        ALTER TABLE tasks ADD COLUMN due_date TEXT;
      `)
    },
  },
  {
    name: '0014_manga_pages',
    up: (db) => {
      db.exec(`
        CREATE TABLE manga_pages (
          id TEXT PRIMARY KEY,
          episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
          number INTEGER NOT NULL,
          reading_direction TEXT NOT NULL DEFAULT 'RTL',
          layout_notes TEXT,
          status TEXT NOT NULL DEFAULT 'TODO',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (episode_id, number)
        );
        CREATE INDEX idx_manga_pages_ep ON manga_pages (episode_id, number);

        CREATE TABLE manga_panels (
          id TEXT PRIMARY KEY,
          page_id TEXT NOT NULL REFERENCES manga_pages(id) ON DELETE CASCADE,
          order_index INTEGER NOT NULL,
          shot_id TEXT REFERENCES shots(id) ON DELETE SET NULL,
          image_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
          lettering TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX idx_manga_panels_page ON manga_panels (page_id, order_index);
      `)
    },
  },
  {
    name: '0015_manga_panel_layout',
    up: (db) => {
      db.exec(`
        ALTER TABLE manga_panels ADD COLUMN x REAL;
        ALTER TABLE manga_panels ADD COLUMN y REAL;
        ALTER TABLE manga_panels ADD COLUMN w REAL;
        ALTER TABLE manga_panels ADD COLUMN h REAL;
      `)
    },
  },
  {
    name: '0016_moodboard_items',
    up: (db) => {
      db.exec(`
        CREATE TABLE moodboard_items (
          id TEXT PRIMARY KEY,
          image_asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          caption TEXT,
          color TEXT,
          order_index INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX idx_moodboard_order ON moodboard_items (order_index);
      `)
    },
  },
  {
    name: '0017_localization',
    up: (db) => {
      db.exec(`
        CREATE TABLE scene_translations (
          id TEXT PRIMARY KEY,
          scene_id TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
          language TEXT NOT NULL,
          screenplay TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'DRAFT',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (scene_id, language)
        );
        CREATE INDEX idx_translations_scene ON scene_translations (scene_id);

        CREATE TABLE glossary_terms (
          id TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          target TEXT NOT NULL,
          language TEXT NOT NULL,
          notes TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (source, language)
        );
        CREATE INDEX idx_glossary_lang ON glossary_terms (language);
      `)
    },
  },
  {
    name: '0018_character_tts_voice',
    up: (db) => {
      db.exec(`
        ALTER TABLE characters ADD COLUMN tts_voice TEXT;
      `)
    },
  },
  {
    name: '0019_character_reference_sheet',
    up: (db) => {
      db.exec(`
        ALTER TABLE characters ADD COLUMN reference_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL;
      `)
    },
  },
  {
    name: '0020_animation_pipeline',
    up: (db) => {
      db.exec(`
        CREATE TABLE animation_pipelines (
          id TEXT PRIMARY KEY,
          scene_id TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
          fps INTEGER NOT NULL DEFAULT 24,
          inbetween_count INTEGER NOT NULL DEFAULT 2,
          inbetween_easing TEXT NOT NULL DEFAULT 'easeInOut',
          enforce_consistency INTEGER NOT NULL DEFAULT 1,
          current_stage TEXT NOT NULL DEFAULT 'KEYFRAME',
          frames_by_stage TEXT NOT NULL DEFAULT '{}',
          updated_at TEXT NOT NULL,
          UNIQUE (scene_id)
        );
        CREATE INDEX idx_animation_pipelines_scene ON animation_pipelines (scene_id);

        CREATE TABLE animation_frames (
          id TEXT PRIMARY KEY,
          scene_id TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
          at_sec REAL NOT NULL DEFAULT 0,
          stage TEXT NOT NULL,
          asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
          source_keyframe_id TEXT REFERENCES animation_frames(id) ON DELETE SET NULL,
          inbetween_spec TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX idx_animation_frames_scene ON animation_frames (scene_id, at_sec);
        CREATE INDEX idx_animation_frames_stage ON animation_frames (stage);
      `)
    },
  },
  {
    name: '0021_audio_mix',
    up: (db) => {
      db.exec(`
        CREATE TABLE audio_masters (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          scene_id TEXT REFERENCES scenes(id) ON DELETE SET NULL,
          kind TEXT NOT NULL DEFAULT 'MIX',
          output_path TEXT NOT NULL,
          duration_seconds REAL NOT NULL DEFAULT 0,
          file_bytes INTEGER NOT NULL DEFAULT 0,
          sample_rate INTEGER NOT NULL DEFAULT 48000,
          channels INTEGER NOT NULL DEFAULT 2,
          bitrate_kbps INTEGER NOT NULL DEFAULT 192,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX idx_audio_masters_scene ON audio_masters (scene_id);

        CREATE TABLE audio_mix_tracks (
          id TEXT PRIMARY KEY,
          master_id TEXT NOT NULL REFERENCES audio_masters(id) ON DELETE CASCADE,
          media_id TEXT NOT NULL REFERENCES media_tracks(id) ON DELETE CASCADE,
          volume REAL NOT NULL DEFAULT 1.0,
          pan REAL NOT NULL DEFAULT 0.0,
          start_offset REAL NOT NULL DEFAULT 0,
          duration_override REAL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX idx_audio_mix_tracks_master ON audio_mix_tracks (master_id);
      `)
    },
  },
  {
    name: '0022_asset_intelligence',
    up: (db) => {
      db.exec(`
        CREATE TABLE asset_usage_history (
          id TEXT PRIMARY KEY,
          asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          context_kind TEXT NOT NULL,           -- 'SHOT' | 'SCENE' | 'PAGE' | 'PANEL' | 'MOODBOARD' | 'CHARACTER' | 'ANIMATION' | 'MEDIA'
          context_id TEXT NOT NULL,             -- id do shot, scene, page, etc.
          context_role TEXT,                    -- 'frame' | 'audio' | 'video' | 'blend' | 'image_asset' | 'reference' | 'cover' | 'role' ...
          used_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX idx_asset_usage_asset ON asset_usage_history (asset_id);
        CREATE INDEX idx_asset_usage_context ON asset_usage_history (context_kind, context_id);

        CREATE TABLE asset_dependency_graph (
          id TEXT PRIMARY KEY,
          source_asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          target_asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          relation TEXT NOT NULL,               -- 'cleanup_of' | 'color_of' | 'composite_of' | 'keyframe_for' | 'version_of' | 'reference_for'
          created_at TEXT NOT NULL
        );
        CREATE INDEX idx_asset_dep_source ON asset_dependency_graph (source_asset_id);
        CREATE INDEX idx_asset_dep_target ON asset_dependency_graph (target_asset_id);
        CREATE UNIQUE INDEX idx_asset_dep_unique ON asset_dependency_graph (source_asset_id, target_asset_id, relation);
      `)
    },
  },
]
