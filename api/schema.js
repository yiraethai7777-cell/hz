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
 `);}
module.exports={init};
