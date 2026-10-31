const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is required. Set it to the Neon pooled PostgreSQL connection string with sslmode=require.'
  );
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000
});

pool.on('error', error => {
  console.error('Unexpected idle PostgreSQL client error', { code: error.code || 'unknown' });
});

function isConnectionError(error) {
  const code = error?.code || '';
  return code.startsWith('08')
    || ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', '57P01', '57P02', '57P03', '53300'].includes(code)
    || /timeout exceeded when trying to connect|connection terminated unexpectedly|connection terminated due to connection timeout/i
      .test(error?.message || '');
}

async function retryConnection(operation, label) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (!isConnectionError(error) || attempt === 1) {
        console.error(`PostgreSQL ${label} failed`, {
          code: error.code || 'unknown',
          attempts: attempt + 1
        });
        throw error;
      }
      console.warn(`PostgreSQL ${label} connection failed; retrying once`, {
        code: error.code || 'unknown'
      });
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  throw new Error(`PostgreSQL ${label} failed after retry`);
}

function query(text, values = [], label = 'query') {
  return retryConnection(() => pool.query(text, values), label);
}

function transaction(callback, label = 'transaction') {
  return (async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const client = await retryConnection(() => pool.connect(), `${label} connection`);
      let commitStarted = false;
      try {
        await client.query('BEGIN');
        const result = await callback(client);
        commitStarted = true;
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          console.error('PostgreSQL rollback failed', { code: rollbackError.code || 'unknown' });
        }
        if (attempt === 0 && !commitStarted && isConnectionError(error)) {
          console.warn(`PostgreSQL ${label} connection failed; retrying transaction once`, {
            code: error.code || 'unknown'
          });
          continue;
        }
        console.error(`PostgreSQL ${label} failed`, {
          code: error.code || 'unknown',
          attempts: attempt + 1
        });
        throw error;
      } finally {
        client.release();
      }
    }
    throw new Error(`PostgreSQL ${label} failed after retry`);
  })();
}

module.exports = { pool, query, transaction };
