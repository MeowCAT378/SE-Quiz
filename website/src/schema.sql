-- ============================================================================
-- Fuiz Library Database Schema
-- ============================================================================
--
-- DESIGN PHILOSOPHY
-- -----------------
-- Git is the Source of Truth:
--   - Submissions = Pull Requests (tracked in GitLab/GitHub)
--   - Reviews/Comments = PR comments
--   - Approvals = PR merges
--   - Version History = Git history
--
-- Database is a Read-Optimized Cache:
--   - Stores only published fuizzes for fast library queries
--   - Metadata extracted from TOML files
--   - Statistics tracked for sorting/ranking
--   - Webhooks keep it in sync with Git
--
-- PUBLISHING FLOW
-- ---------------
-- 1. User creates fuiz in app
-- 2. User clicks "Publish" and authenticates with GitLab/GitHub
-- 3. App creates PR with TOML + images to upstream repo
-- 4. Maintainer reviews and merges PR
-- 5. Webhook triggers sync script:
--    - Fetches processed config from R2
--    - Downloads images from Git, uploads to Corkboard
--    - Generates thumbnail
--    - Inserts into fuizzes table
-- 6. Fuiz appears in public library
--
-- UPDATE FLOW
-- -----------
-- Same as publish, but preserves play_count and view_count
--
-- REPOSITORY STRUCTURE
-- --------------------
-- Each fuiz is stored in its own directory:
--   {uuid1}/
--     config.toml
--     abc123def456.png
--     789fedcba321.jpg
--   {uuid2}/
--     config.toml
--     image1hash.webp
--
-- ============================================================================
-- ============================================================================
-- PUBLISHED FUIZZES
-- ============================================================================
-- The public library of approved fuizzes
--
-- Indexes:
--   - language: Filter by language
--   - published_at DESC: Recent additions
--   - played_count DESC: Popular fuizzes
--   - updated_at DESC: Recently updated
-- ============================================================================
CREATE TABLE
    IF NOT EXISTS "fuizzes" (
        "id" text NOT NULL, -- Fuiz ID (same as directory name in Git)
        "storage_id" text NOT NULL, -- R2 bucket key for raw TOML content
        -- Metadata
        "title" text NOT NULL,
        "author" text NOT NULL,
        "language" text NOT NULL,
        "subjects" text DEFAULT NULL, -- JSON array: ["math", "science"]
        "grades" text DEFAULT NULL, -- JSON array: ["K-2", "3-5"]
        "keywords" text DEFAULT NULL, -- JSON array: ["educational", "interactive"]
        "slides_count" integer NOT NULL,
        "thumbnail" BLOB DEFAULT NULL,
        "thumbnail_alt" text DEFAULT NULL,
        -- Git reference (for updates/rollbacks)
        "git_commit_sha" text DEFAULT NULL,
        -- Statistics
        "played_count" integer NOT NULL DEFAULT 0,
        "view_count" integer NOT NULL DEFAULT 0,
        -- Timestamps
        "published_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE (storage_id)
    );

CREATE INDEX IF NOT EXISTS "fuizzes_language" ON "fuizzes" ("language");

CREATE INDEX IF NOT EXISTS "fuizzes_published" ON "fuizzes" ("published_at" DESC);

CREATE INDEX IF NOT EXISTS "fuizzes_played" ON "fuizzes" ("played_count" DESC);

CREATE INDEX IF NOT EXISTS "fuizzes_updated" ON "fuizzes" ("updated_at" DESC);

CREATE TABLE
    IF NOT EXISTS active_games (
        quiz_id TEXT PRIMARY KEY,
        game_code TEXT NOT NULL,
        started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

CREATE TABLE
    IF NOT EXISTS admins (
        email TEXT PRIMARY KEY NOT NULL CHECK (email = lower(trim(email))),
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime ('%Y-%m-%dT%H:%M:%fZ', 'now')),
        id TEXT NOT NULL UNIQUE CHECK (length (id) = 36),
        role TEXT NOT NULL DEFAULT 'TEACHER' CHECK (role IN ('TEACHER', 'ADMIN')),
        deleted_at TEXT,
        session_version INTEGER NOT NULL DEFAULT 0 CHECK (
            typeof (session_version) = 'integer'
            AND session_version >= 0
        )
    );

CREATE TABLE
    IF NOT EXISTS auth_login_limits (
        key TEXT PRIMARY KEY NOT NULL,
        attempts INTEGER NOT NULL CHECK (attempts >= 0),
        expires_at INTEGER NOT NULL
    );

CREATE INDEX IF NOT EXISTS auth_login_limits_expiry ON auth_login_limits (expires_at);

CREATE TRIGGER IF NOT EXISTS admins_last_active BEFORE
UPDATE OF role,
deleted_at ON admins WHEN OLD.role = 'ADMIN'
AND OLD.deleted_at IS NULL
AND (
    NEW.role != 'ADMIN'
    OR NEW.deleted_at IS NOT NULL
)
AND (
    SELECT
        count(*)
    FROM
        admins
    WHERE
        role = 'ADMIN'
        AND deleted_at IS NULL
) <= 1 BEGIN
SELECT
    RAISE (ABORT, 'last active administrator');

END;

CREATE TRIGGER IF NOT EXISTS admins_no_delete BEFORE DELETE ON admins BEGIN
SELECT
    RAISE (ABORT, 'physical account deletion is forbidden');

END;

CREATE TRIGGER IF NOT EXISTS admins_immutable_id BEFORE
UPDATE OF id ON admins WHEN NEW.id != OLD.id BEGIN
SELECT
    RAISE (ABORT, 'account identity is immutable');

END;

CREATE TRIGGER IF NOT EXISTS admins_valid_insert BEFORE INSERT ON admins WHEN NEW.id IS NULL
OR length (NEW.id) != 36
OR NEW.role IS NULL
OR NEW.role NOT IN ('TEACHER', 'ADMIN')
OR NEW.session_version IS NULL
OR typeof (NEW.session_version) != 'integer'
OR NEW.session_version < 0
OR NEW.email != lower(trim(NEW.email)) BEGIN
SELECT
    RAISE (ABORT, 'invalid managed account');

END;

CREATE TRIGGER IF NOT EXISTS admins_valid_update BEFORE
UPDATE ON admins WHEN NEW.id IS NULL
OR length (NEW.id) != 36
OR NEW.role IS NULL
OR NEW.role NOT IN ('TEACHER', 'ADMIN')
OR NEW.session_version IS NULL
OR typeof (NEW.session_version) != 'integer'
OR NEW.session_version < 0
OR NEW.email != lower(trim(NEW.email)) BEGIN
SELECT
    RAISE (ABORT, 'invalid managed account');

END;

-- Private records never inherit ownership from legacy browser or active-game data.
CREATE TABLE
    IF NOT EXISTS host_resources (
        owner_id TEXT NOT NULL REFERENCES admins (id),
        kind TEXT NOT NULL CHECK (kind IN ('creation', 'report')),
        unique_id TEXT NOT NULL,
        version_id INTEGER NOT NULL CHECK (version_id >= 0),
        body TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (owner_id, kind, unique_id)
    );

CREATE TABLE
    IF NOT EXISTS host_games (
        instance_id TEXT PRIMARY KEY NOT NULL,
        code TEXT NOT NULL,
        owner_id TEXT NOT NULL REFERENCES admins (id),
        host_watcher_id TEXT NOT NULL,
        origin_unique_id TEXT,
        origin_version_id INTEGER,
        session_version INTEGER NOT NULL CHECK (session_version >= 0),
        listed INTEGER NOT NULL DEFAULT 1 CHECK (listed IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        ended_at TEXT,
        CHECK (
            (
                origin_unique_id IS NULL
                AND origin_version_id IS NULL
            )
            OR (
                origin_unique_id IS NOT NULL
                AND origin_version_id IS NOT NULL
                AND origin_version_id >= 0
            )
        )
    );

CREATE UNIQUE INDEX IF NOT EXISTS host_games_current_code ON host_games (code)
WHERE
    ended_at IS NULL;

CREATE INDEX IF NOT EXISTS host_games_owner ON host_games (owner_id);

CREATE TRIGGER IF NOT EXISTS host_games_validate BEFORE INSERT ON host_games WHEN NOT EXISTS (
    SELECT
        1
    FROM
        admins
    WHERE
        id = NEW.owner_id
        AND session_version = NEW.session_version
        AND deleted_at IS NULL
        AND role IN ('ADMIN', 'TEACHER')
)
OR (
    NEW.origin_unique_id IS NOT NULL
    AND NOT EXISTS (
        SELECT
            1
        FROM
            host_resources
        WHERE
            owner_id = NEW.owner_id
            AND kind = 'creation'
            AND unique_id = NEW.origin_unique_id
            AND version_id = NEW.origin_version_id
            AND json_extract (body, '$.uniqueId') = NEW.origin_unique_id
            AND json_extract (body, '$.versionId') = NEW.origin_version_id
    )
) BEGIN
SELECT
    RAISE (
        ABORT,
        'Current account and owned creation required'
    );

END;

-- Additive private storage upgrade: existing JSON bodies and historical bindings stay intact.
CREATE TABLE
    IF NOT EXISTS host_media (
        owner_id TEXT NOT NULL REFERENCES admins (id),
        hash TEXT NOT NULL,
        content_digest TEXT NOT NULL,
        blob_key TEXT NOT NULL,
        mime TEXT NOT NULL,
        byte_size INTEGER NOT NULL CHECK (byte_size > 0),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (owner_id, hash)
    );

CREATE TABLE
    IF NOT EXISTS host_imports (
        owner_id TEXT NOT NULL REFERENCES admins (id),
        kind TEXT NOT NULL CHECK (kind IN ('creation', 'report')),
        source_kind TEXT NOT NULL CHECK (source_kind IN ('IndexedDB', 'legacyGoogleDrive')),
        source_id TEXT NOT NULL,
        content_digest TEXT NOT NULL,
        copy INTEGER NOT NULL CHECK (copy IN (0, 1)),
        unique_id TEXT NOT NULL,
        actor_id TEXT NOT NULL REFERENCES admins (id),
        imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (
            owner_id,
            kind,
            source_kind,
            source_id,
            content_digest,
            copy
        )
    );

CREATE UNIQUE INDEX IF NOT EXISTS host_imports_original_source ON host_imports (owner_id, kind, source_kind, source_id)
WHERE
    copy = 0;
-- Activity LLM settings: additive, no operational defaults or credentials are seeded.
CREATE TABLE IF NOT EXISTS llm_configurations (
 id TEXT PRIMARY KEY,
 settings TEXT NOT NULL,
 encrypted_key TEXT,
 deleted_at TEXT,
 version INTEGER NOT NULL CHECK(version > 0),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
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
 created_at TEXT NOT NULL,
 action TEXT NOT NULL,
 changed_fields TEXT NOT NULL,
 credential_action TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS llm_audit_configuration ON llm_audit(configuration_id,created_at);

-- Data integrity: triggers also protect pre-existing D1 tables without rebuilding or rewriting them.
CREATE TRIGGER IF NOT EXISTS fuizzes_integrity_insert BEFORE INSERT ON fuizzes
WHEN NEW.slides_count < 0 OR NEW.played_count < 0 OR NEW.view_count < 0
OR CASE WHEN NEW.subjects IS NULL THEN 0 WHEN json_valid(NEW.subjects) THEN json_type(NEW.subjects) <> 'array' ELSE 1 END
OR CASE WHEN NEW.grades IS NULL THEN 0 WHEN json_valid(NEW.grades) THEN json_type(NEW.grades) <> 'array' ELSE 1 END
OR CASE WHEN NEW.keywords IS NULL THEN 0 WHEN json_valid(NEW.keywords) THEN json_type(NEW.keywords) <> 'array' ELSE 1 END
BEGIN
 SELECT RAISE(ABORT, 'invalid fuizzes data');
END;

CREATE TRIGGER IF NOT EXISTS fuizzes_integrity_update BEFORE UPDATE ON fuizzes
WHEN NEW.slides_count < 0 OR NEW.played_count < 0 OR NEW.view_count < 0
OR CASE WHEN NEW.subjects IS NULL THEN 0 WHEN json_valid(NEW.subjects) THEN json_type(NEW.subjects) <> 'array' ELSE 1 END
OR CASE WHEN NEW.grades IS NULL THEN 0 WHEN json_valid(NEW.grades) THEN json_type(NEW.grades) <> 'array' ELSE 1 END
OR CASE WHEN NEW.keywords IS NULL THEN 0 WHEN json_valid(NEW.keywords) THEN json_type(NEW.keywords) <> 'array' ELSE 1 END
BEGIN
 SELECT RAISE(ABORT, 'invalid fuizzes data');
END;

CREATE TRIGGER IF NOT EXISTS host_resources_integrity_insert BEFORE INSERT ON host_resources
WHEN CASE WHEN json_valid(NEW.body) THEN json_type(NEW.body) <> 'object' ELSE 1 END
BEGIN
 SELECT RAISE(ABORT, 'invalid host_resources data');
END;

CREATE TRIGGER IF NOT EXISTS host_resources_integrity_update BEFORE UPDATE ON host_resources
WHEN CASE WHEN json_valid(NEW.body) THEN json_type(NEW.body) <> 'object' ELSE 1 END
BEGIN
 SELECT RAISE(ABORT, 'invalid host_resources data');
END;

CREATE TRIGGER IF NOT EXISTS llm_configurations_integrity_insert BEFORE INSERT ON llm_configurations
WHEN CASE WHEN json_valid(NEW.settings) THEN json_type(NEW.settings) <> 'object' ELSE 1 END
BEGIN
 SELECT RAISE(ABORT, 'invalid llm_configurations data');
END;

CREATE TRIGGER IF NOT EXISTS llm_configurations_integrity_update BEFORE UPDATE ON llm_configurations
WHEN CASE WHEN json_valid(NEW.settings) THEN json_type(NEW.settings) <> 'object' ELSE 1 END
BEGIN
 SELECT RAISE(ABORT, 'invalid llm_configurations data');
END;

CREATE TRIGGER IF NOT EXISTS llm_audit_integrity_insert BEFORE INSERT ON llm_audit
WHEN NEW.configuration_version <= 0
OR NEW.action NOT IN ('create','update','import','activate','deactivate','delete')
OR NEW.credential_action NOT IN ('keep','replace','remove')
OR CASE WHEN json_valid(NEW.changed_fields) THEN json_type(NEW.changed_fields) <> 'array' ELSE 1 END
BEGIN
 SELECT RAISE(ABORT, 'invalid llm_audit data');
END;

CREATE TRIGGER IF NOT EXISTS llm_audit_integrity_update BEFORE UPDATE ON llm_audit
WHEN NEW.configuration_version <= 0
OR NEW.action NOT IN ('create','update','import','activate','deactivate','delete')
OR NEW.credential_action NOT IN ('keep','replace','remove')
OR CASE WHEN json_valid(NEW.changed_fields) THEN json_type(NEW.changed_fields) <> 'array' ELSE 1 END
BEGIN
 SELECT RAISE(ABORT, 'invalid llm_audit data');
END;
