'use strict';
const {getPool}=require('../shared/db');
async function init(){await getPool().query(`
 CREATE TABLE IF NOT EXISTS gl_audit(id BIGSERIAL PRIMARY KEY,actor TEXT NOT NULL,action TEXT NOT NULL,room_id TEXT,target_id TEXT,detail JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE TABLE IF NOT EXISTS gl_web_sessions(token_hash TEXT PRIMARY KEY,csrf TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL);
 CREATE TABLE IF NOT EXISTS gl_public_profiles(room_id TEXT NOT NULL,user_id TEXT NOT NULL,alias TEXT NOT NULL,consent BOOLEAN NOT NULL DEFAULT FALSE,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(room_id,user_id));
 CREATE TABLE IF NOT EXISTS gl_notices(id BIGSERIAL PRIMARY KEY,title TEXT NOT NULL,body TEXT NOT NULL,pinned BOOLEAN NOT NULL DEFAULT FALSE,published BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE TABLE IF NOT EXISTS gl_admin_operations(operation_id TEXT PRIMARY KEY,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE TABLE IF NOT EXISTS gl_stock_alerts(id BIGSERIAL PRIMARY KEY,room_id TEXT NOT NULL,user_id TEXT NOT NULL,symbol TEXT NOT NULL,stock_name TEXT NOT NULL,threshold BIGINT NOT NULL CHECK(threshold>0),direction TEXT NOT NULL CHECK(direction IN ('above','below')),enabled BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE TABLE IF NOT EXISTS gl_promotion_logs(id BIGSERIAL PRIMARY KEY,room_id TEXT NOT NULL,slot TEXT NOT NULL,status TEXT NOT NULL,detail TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(room_id,slot));
 CREATE TABLE IF NOT EXISTS gl_bot_promotion_settings(id INTEGER PRIMARY KEY CHECK(id=1),message TEXT NOT NULL DEFAULT '',updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE TABLE IF NOT EXISTS gl_promo_users(id BIGSERIAL PRIMARY KEY,username TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,display_name TEXT NOT NULL,enabled BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE TABLE IF NOT EXISTS gl_promo_sessions(token_hash TEXT PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES gl_promo_users(id),csrf TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL);
 CREATE TABLE IF NOT EXISTS gl_promo_room_access(user_id BIGINT NOT NULL REFERENCES gl_promo_users(id),room_id TEXT NOT NULL,PRIMARY KEY(user_id,room_id));
 CREATE TABLE IF NOT EXISTS gl_promo_invites(id BIGSERIAL PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE,label TEXT NOT NULL,room_ids JSONB NOT NULL,created_by TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL,used_at TIMESTAMPTZ,used_by BIGINT REFERENCES gl_promo_users(id),revoked_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 ALTER TABLE gl_promotion_logs ADD COLUMN IF NOT EXISTS portal_user_id BIGINT REFERENCES gl_promo_users(id);
 CREATE INDEX IF NOT EXISTS gl_promo_logs_user_time ON gl_promotion_logs(portal_user_id,created_at);
 CREATE TABLE IF NOT EXISTS gl_promo_kakao(user_id BIGINT PRIMARY KEY REFERENCES gl_promo_users(id),kakao_id TEXT NOT NULL UNIQUE,credential TEXT NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE TABLE IF NOT EXISTS gl_promo_account_rooms(user_id BIGINT NOT NULL REFERENCES gl_promo_users(id),room_id TEXT NOT NULL,name TEXT NOT NULL DEFAULT '',present BOOLEAN NOT NULL DEFAULT TRUE,promotion JSONB NOT NULL DEFAULT '{}'::jsonb,PRIMARY KEY(user_id,room_id));
 CREATE TABLE IF NOT EXISTS gl_promo_account_logs(id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES gl_promo_users(id),room_id TEXT NOT NULL,slot TEXT NOT NULL,status TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(user_id,room_id,slot));
 CREATE TABLE IF NOT EXISTS gl_promo_account_settings(user_id BIGINT PRIMARY KEY REFERENCES gl_promo_users(id),message TEXT NOT NULL DEFAULT '',updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 INSERT INTO gl_promo_account_settings(user_id,message)
 SELECT u.id,CASE WHEN count(DISTINCT NULLIF(trim(r.promotion->>'message'),''))=1 THEN max(NULLIF(trim(r.promotion->>'message'),'')) ELSE '' END
 FROM gl_promo_users u LEFT JOIN gl_promo_account_rooms r ON r.user_id=u.id GROUP BY u.id
 ON CONFLICT(user_id) DO NOTHING;
 `);}
module.exports={init};
