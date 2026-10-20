import { neon } from '@neondatabase/serverless';
import { createHash, timingSafeEqual } from 'node:crypto';

const QUIZ_CHAPTER = '7';
const TA_PASSCODE_HASH = '8cb174721dd8f8b3457d3845169fa426204e9489ad95c1ca9c922adf7ddd1b93';

function getDatabaseUrl() {
  return process.env.QUIZ_DATABASE_URL
    || process.env.QUIZ_POSTGRES_URL
    || process.env.QUIZ_POSTGRES_PRISMA_URL
    || process.env.QUIZ_POSTGRES_URL_NON_POOLING
    || process.env.DATABASE_URL
    || process.env.POSTGRES_URL;
}

function authorized(request) {
  const supplied = request.headers['x-ta-passcode'] || '';
  const digest = createHash('sha256').update(String(supplied)).digest('hex');
  return timingSafeEqual(Buffer.from(digest), Buffer.from(TA_PASSCODE_HASH));
}

async function prepare(sql) {
  await sql`CREATE TABLE IF NOT EXISTS quiz_results (
    session_id TEXT PRIMARY KEY,
    student_name TEXT NOT NULL,
    score INTEGER NOT NULL DEFAULT 0,
    answered INTEGER NOT NULL DEFAULT 0,
    current_level INTEGER NOT NULL DEFAULT 2,
    highest_level INTEGER NOT NULL DEFAULT 2,
    completed BOOLEAN NOT NULL DEFAULT FALSE,
    chapter TEXT NOT NULL DEFAULT '2',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`ALTER TABLE quiz_results ADD COLUMN IF NOT EXISTS chapter TEXT NOT NULL DEFAULT '2'`;
}

export default async function handler(request, response) {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) return response.status(503).json({ error: 'Quiz database is not configured.' });

  try {
    const sql = neon(databaseUrl);
    await prepare(sql);

    if (request.method === 'POST') {
      const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
      const id = String(body?.id || '').slice(0, 100);
      const student = String(body?.student || 'Anonymous student').trim().slice(0, 80) || 'Anonymous student';
      const score = Math.max(0, Math.min(10, Number(body?.score) || 0));
      const answered = Math.max(0, Math.min(10, Number(body?.answered) || 0));
      const level = Math.max(1, Math.min(3, Number(body?.level) || 2));
      const highestLevel = Math.max(1, Math.min(3, Number(body?.highestLevel) || 2));
      const completed = Boolean(body?.completed);
      const chapter = QUIZ_CHAPTER;
      if (!id) return response.status(400).json({ error: 'Missing session id.' });

      await sql`INSERT INTO quiz_results (session_id, student_name, score, answered, current_level, highest_level, completed, chapter, updated_at)
        VALUES (${id}, ${student}, ${score}, ${answered}, ${level}, ${highestLevel}, ${completed}, ${chapter}, NOW())
        ON CONFLICT (session_id) DO UPDATE SET student_name=${student}, score=${score}, answered=${answered}, current_level=${level}, highest_level=${highestLevel}, completed=${completed}, chapter=${chapter}, updated_at=NOW()`;
      return response.status(200).json({ ok: true });
    }

    if (request.method === 'GET') {
      if (!authorized(request)) return response.status(401).json({ error: 'Incorrect TA passcode.' });
      const chapter = QUIZ_CHAPTER;
      const rows = await sql`SELECT session_id, student_name, score, answered, current_level, highest_level, completed, updated_at FROM quiz_results WHERE chapter=${chapter} ORDER BY updated_at DESC LIMIT 1000`;
      return response.status(200).json(rows.map(row => ({
        id: row.session_id,
        student: row.student_name,
        score: row.score,
        answered: row.answered,
        level: row.current_level,
        highestLevel: row.highest_level,
        completed: row.completed,
        updatedAt: new Date(row.updated_at).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })
      })));
    }

    if (request.method === 'DELETE') {
      if (!authorized(request)) return response.status(401).json({ error: 'Incorrect TA passcode.' });
      const chapter = QUIZ_CHAPTER;
      await sql`DELETE FROM quiz_results WHERE chapter=${chapter}`;
      return response.status(200).json({ ok: true });
    }

    response.setHeader('Allow', 'GET, POST, DELETE');
    return response.status(405).json({ error: 'Method not allowed.' });
  } catch (error) {
    console.error('Quiz results API error:', error);
    return response.status(500).json({ error: 'Unable to access quiz results.' });
  }
}
