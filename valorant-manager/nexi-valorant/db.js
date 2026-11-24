'use strict';
// Connect copied NEXI helpers to the School PostgreSQL pool.
let pool=null;
function bindPool(db){if(!db||typeof db.query!=='function')throw Error('Database pool required');pool=db;}
function getPool(){if(!pool)throw Error('School database pool not initialized');return pool;}
module.exports={bindPool,getPool};
