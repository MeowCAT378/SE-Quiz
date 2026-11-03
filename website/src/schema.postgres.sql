CREATE TABLE IF NOT EXISTS fuizzes (
	id TEXT PRIMARY KEY,
	storage_id TEXT NOT NULL UNIQUE,
	title TEXT NOT NULL,
	author TEXT NOT NULL,
	language TEXT NOT NULL,
	subjects TEXT,
	grades TEXT,
	keywords TEXT,
	slides_count INTEGER NOT NULL,
	thumbnail BYTEA,
	thumbnail_alt TEXT,
	git_commit_sha TEXT,
	played_count INTEGER NOT NULL DEFAULT 0,
	view_count INTEGER NOT NULL DEFAULT 0,
	published_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS fuizzes_language ON fuizzes (language);
CREATE INDEX IF NOT EXISTS fuizzes_published ON fuizzes (published_at DESC);
CREATE INDEX IF NOT EXISTS fuizzes_played ON fuizzes (played_count DESC);
CREATE INDEX IF NOT EXISTS fuizzes_updated ON fuizzes (updated_at DESC);

CREATE TABLE IF NOT EXISTS active_games (
	quiz_id TEXT PRIMARY KEY,
	game_code TEXT NOT NULL,
	started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS kv_entries (
	namespace TEXT NOT NULL,
	key TEXT NOT NULL,
	value TEXT NOT NULL,
	expires_at TIMESTAMPTZ,
	PRIMARY KEY (namespace, key)
);
CREATE INDEX IF NOT EXISTS kv_entries_expiry ON kv_entries (expires_at) WHERE expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS admins (
	email TEXT PRIMARY KEY CHECK (email = lower(trim(email))),
	password_hash TEXT NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 id TEXT NOT NULL UNIQUE CHECK (id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
 role TEXT NOT NULL DEFAULT 'TEACHER' CHECK (role IN ('TEACHER', 'ADMIN')),
 deleted_at TIMESTAMPTZ,
 session_version INTEGER NOT NULL DEFAULT 0 CHECK (session_version >= 0)
);
CREATE TABLE IF NOT EXISTS auth_login_limits (
 key TEXT PRIMARY KEY,
 attempts INTEGER NOT NULL CHECK (attempts >= 0),
 expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_login_limits_expiry ON auth_login_limits(expires_at);

-- Private records never inherit ownership from legacy browser or active-game data.
CREATE TABLE IF NOT EXISTS host_resources (
 owner_id TEXT NOT NULL REFERENCES admins(id),
 kind TEXT NOT NULL CHECK (kind IN ('creation','report')),
 unique_id TEXT NOT NULL,
 version_id BIGINT NOT NULL CHECK (version_id >= 0),
 body TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (owner_id,kind,unique_id)
);
CREATE TABLE IF NOT EXISTS host_games (
 instance_id TEXT PRIMARY KEY,
 code TEXT NOT NULL,
 owner_id TEXT NOT NULL REFERENCES admins(id),
 host_watcher_id TEXT NOT NULL,
 origin_unique_id TEXT,
 origin_version_id BIGINT,
 session_version INTEGER NOT NULL CHECK (session_version >= 0),
 listed INTEGER NOT NULL DEFAULT 1 CHECK (listed IN (0,1)),
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 ended_at TIMESTAMPTZ,
 CHECK ((origin_unique_id IS NULL AND origin_version_id IS NULL) OR (origin_unique_id IS NOT NULL AND origin_version_id IS NOT NULL AND origin_version_id >= 0))
);
CREATE UNIQUE INDEX IF NOT EXISTS host_games_current_code ON host_games(code) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS host_games_owner ON host_games(owner_id);

-- Additive private storage upgrade: existing JSON bodies and historical bindings stay intact.
CREATE TABLE IF NOT EXISTS host_media (
 owner_id TEXT NOT NULL REFERENCES admins(id),
 hash TEXT NOT NULL,
 content_digest TEXT NOT NULL,
 blob_key TEXT NOT NULL,
 mime TEXT NOT NULL,
 byte_size INTEGER NOT NULL CHECK (byte_size > 0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (owner_id,hash)
);
CREATE TABLE IF NOT EXISTS host_imports (
 owner_id TEXT NOT NULL REFERENCES admins(id),
 kind TEXT NOT NULL CHECK (kind IN ('creation','report')),
 source_kind TEXT NOT NULL CHECK (source_kind IN ('IndexedDB','legacyGoogleDrive')),
 source_id TEXT NOT NULL,
 content_digest TEXT NOT NULL,
 copy INTEGER NOT NULL CHECK (copy IN (0,1)),
 unique_id TEXT NOT NULL,
 actor_id TEXT NOT NULL REFERENCES admins(id),
 imported_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (owner_id,kind,source_kind,source_id,content_digest,copy)
);
CREATE UNIQUE INDEX IF NOT EXISTS host_imports_original_source ON host_imports(owner_id,kind,source_kind,source_id) WHERE copy=0;

-- Activity LLM settings: additive, no operational defaults or credentials are seeded.
CREATE TABLE IF NOT EXISTS llm_configurations (
 id TEXT PRIMARY KEY,
 settings TEXT NOT NULL,
 encrypted_key TEXT,
 deleted_at TIMESTAMPTZ,
 version INTEGER NOT NULL CHECK(version > 0),
 created_at TIMESTAMPTZ NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL,
 created_by TEXT NOT NULL REFERENCES admins(id),
 updated_by TEXT NOT NULL REFERENCES admins(id)
);
CREATE TABLE IF NOT EXISTS llm_state (
 id INTEGER PRIMARY KEY CHECK(id=1),
 active_id TEXT REFERENCES llm_configurations(id),
 version INTEGER NOT NULL CHECK(version >= 0),
 established INTEGER NOT NULL CHECK(established IN (0,1)),
 mutation_id TEXT
);
CREATE TABLE IF NOT EXISTS llm_audit (
 id TEXT PRIMARY KEY,
 configuration_id TEXT NOT NULL REFERENCES llm_configurations(id),
 configuration_version INTEGER NOT NULL,
 actor_id TEXT NOT NULL REFERENCES admins(id),
 created_at TIMESTAMPTZ NOT NULL,
 action TEXT NOT NULL,
 changed_fields TEXT NOT NULL,
 credential_action TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS llm_audit_configuration ON llm_audit(configuration_id,created_at);

-- Data integrity applies to both new tables and existing installations, without rewriting JSON.
-- Startup runs this file in the same transaction as upgrades; invalid legacy data rolls it back.
DO $$
DECLARE rule record;
BEGIN
 FOR rule IN SELECT * FROM (VALUES
  ('fuizzes', 'fuizzes_nonnegative_counts', 'slides_count >= 0 AND played_count >= 0 AND view_count >= 0'),
  ('fuizzes', 'fuizzes_subjects_array', 'subjects IS NULL OR subjects IS JSON ARRAY'),
  ('fuizzes', 'fuizzes_grades_array', 'grades IS NULL OR grades IS JSON ARRAY'),
  ('fuizzes', 'fuizzes_keywords_array', 'keywords IS NULL OR keywords IS JSON ARRAY'),
  ('host_resources', 'host_resources_body_object', 'body IS JSON OBJECT'),
  ('llm_configurations', 'llm_configurations_settings_object', 'settings IS JSON OBJECT'),
  ('llm_audit', 'llm_audit_fields_array', 'changed_fields IS JSON ARRAY'),
  ('llm_audit', 'llm_audit_valid_values', 'configuration_version > 0 AND action IN (''create'',''update'',''import'',''activate'',''deactivate'',''delete'') AND credential_action IN (''keep'',''replace'',''remove'')')
 ) AS rules(table_name, constraint_name, expression) LOOP
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass(rule.table_name) AND conname=rule.constraint_name) THEN
   EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s) NOT VALID', rule.table_name, rule.constraint_name, rule.expression);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass(rule.table_name) AND conname=rule.constraint_name AND NOT convalidated) THEN
   EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', rule.table_name, rule.constraint_name);
  END IF;
 END LOOP;
END $$;
