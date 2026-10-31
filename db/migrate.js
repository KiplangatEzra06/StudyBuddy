require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool, query } = require('./pool');

async function migrate() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await query(schema, [], 'schema migration');
  console.log('StudyBuddy database schema is up to date.');
}

migrate()
  .catch(error => {
    console.error('Database migration failed. Check DATABASE_URL and Neon connectivity.', {
      code: error.code || 'unknown'
    });
    process.exitCode = 1;
  })
  .finally(() => pool.end());
