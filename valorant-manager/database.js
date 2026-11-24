'use strict';
const {Pool}=require('pg');
function createDb(url=process.env.DATABASE_URL){if(!url)throw Error('DATABASE_URL is required');return new Pool({connectionString:url,max:4});}
async function migrate(db){await db.query(`
CREATE TABLE IF NOT EXISTS vs_room_settings (room_id TEXT PRIMARY KEY,enabled BOOLEAN NOT NULL DEFAULT TRUE);
CREATE TABLE IF NOT EXISTS vs_accounts (id BIGSERIAL PRIMARY KEY,user_id TEXT NOT NULL,name TEXT NOT NULL,tag TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(user_id,name,tag));
CREATE TABLE IF NOT EXISTS vs_parties (id BIGSERIAL PRIMARY KEY,room_id TEXT NOT NULL,owner_id TEXT NOT NULL,owner_name TEXT NOT NULL,current_size INTEGER NOT NULL,target_size INTEGER NOT NULL,tier TEXT NOT NULL,code TEXT NOT NULL,members JSONB NOT NULL DEFAULT '[]'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW()+INTERVAL '7 hours');
CREATE INDEX IF NOT EXISTS vs_parties_active ON vs_parties(room_id,expires_at);
CREATE TABLE IF NOT EXISTS vs_duos (
 id BIGSERIAL PRIMARY KEY,
 room_id TEXT NOT NULL,
 owner_id TEXT NOT NULL,
 owner_name TEXT NOT NULL,
 tier TEXT NOT NULL,
 note TEXT NOT NULL DEFAULT '',
 partner_id TEXT,
 partner_name TEXT,
 matched_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW()+INTERVAL '2 hours'
);
CREATE INDEX IF NOT EXISTS vs_duos_available ON vs_duos(room_id,expires_at) WHERE partner_id IS NULL;
CREATE INDEX IF NOT EXISTS vs_duos_owner ON vs_duos(room_id,owner_id);
CREATE INDEX IF NOT EXISTS vs_duos_partner ON vs_duos(room_id,partner_id) WHERE partner_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS vs_scrims (room_id TEXT PRIMARY KEY,scheduled_at TEXT,state JSONB NOT NULL DEFAULT '{}'::jsonb);
CREATE TABLE IF NOT EXISTS vs_scrim_players (room_id TEXT NOT NULL,user_id TEXT NOT NULL,name TEXT NOT NULL,tier TEXT NOT NULL DEFAULT '',discord TEXT NOT NULL DEFAULT '',riot_id TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'active',joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(room_id,user_id));
CREATE TABLE IF NOT EXISTS hz_valorant_saved_accounts (
 kakao_user_id TEXT PRIMARY KEY,
 riot_name TEXT NOT NULL,
 riot_tag TEXT NOT NULL,
 region TEXT NOT NULL CHECK(region IN ('kr','ap','eu','na','br','latam')),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Bring School's existing saved accounts forward without overwriting any newer NEXI-style saves.
INSERT INTO hz_valorant_saved_accounts(kakao_user_id,riot_name,riot_tag,region)
SELECT DISTINCT ON (user_id) user_id,name,tag,'kr'
FROM vs_accounts WHERE user_id<>'' AND name<>'' AND tag<>''
ORDER BY user_id,id DESC
ON CONFLICT(kakao_user_id) DO NOTHING;
CREATE TABLE IF NOT EXISTS vs_attendance (room_id TEXT NOT NULL,user_id TEXT NOT NULL,name TEXT NOT NULL,day TEXT NOT NULL,PRIMARY KEY(room_id,user_id,day));
CREATE INDEX IF NOT EXISTS vs_attendance_room_day ON vs_attendance(room_id,day);
-- Existing attendance rows have no historical timestamp; keep those NULL rather than inventing a time.
ALTER TABLE vs_attendance ADD COLUMN IF NOT EXISTS attended_at TIMESTAMPTZ;
ALTER TABLE vs_attendance ALTER COLUMN attended_at SET DEFAULT NOW();
CREATE INDEX IF NOT EXISTS vs_attendance_day_order ON vs_attendance(room_id,day,attended_at,user_id);
CREATE TABLE IF NOT EXISTS vs_user_ids (serial BIGSERIAL PRIMARY KEY,room_id TEXT NOT NULL,user_id TEXT NOT NULL,UNIQUE(room_id,user_id));
CREATE TABLE IF NOT EXISTS vs_chat_counts (room_id TEXT NOT NULL,user_id TEXT NOT NULL,name TEXT NOT NULL,count BIGINT NOT NULL DEFAULT 0,PRIMARY KEY(room_id,user_id));
CREATE TABLE IF NOT EXISTS vs_chat_daily (room_id TEXT NOT NULL,user_id TEXT NOT NULL,day TEXT NOT NULL,count BIGINT NOT NULL DEFAULT 0,PRIMARY KEY(room_id,user_id,day));
CREATE INDEX IF NOT EXISTS vs_chat_daily_room_day ON vs_chat_daily(room_id,day);
CREATE TABLE IF NOT EXISTS vs_chat_bots (room_id TEXT NOT NULL,user_id TEXT NOT NULL,PRIMARY KEY(room_id,user_id));
CREATE TABLE IF NOT EXISTS vs_chat_legacy_imports (
 room_id TEXT NOT NULL,
 snapshot_id TEXT NOT NULL,
 source_rank INTEGER NOT NULL CHECK(source_rank>0),
 user_id TEXT NOT NULL,
 source_name TEXT NOT NULL,
 source_count BIGINT NOT NULL CHECK(source_count>=0),
 imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(room_id,snapshot_id,source_rank),
 UNIQUE(room_id,snapshot_id,user_id)
);
CREATE TABLE IF NOT EXISTS vs_substitutes (room_id TEXT NOT NULL,user_id TEXT NOT NULL,name TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(room_id,user_id));`)}
async function cleanup(db){await db.query('DELETE FROM vs_parties WHERE expires_at<=NOW()');await db.query('DELETE FROM vs_duos WHERE expires_at<=NOW()')}
module.exports={createDb,migrate,cleanup};