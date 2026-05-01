import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  try {
    const sql = neon(process.env.DATABASE_URL);

    // Drop old tables and recreate with correct schema
    await sql`DROP TABLE IF EXISTS messages CASCADE`;
    await sql`DROP TABLE IF EXISTS sessions CASCADE`;
    await sql`DROP TABLE IF EXISTS students CASCADE`;

    // Students table
    await sql`
      CREATE TABLE IF NOT EXISTS students (
        id SERIAL PRIMARY KEY,
        student_id VARCHAR(10) UNIQUE NOT NULL,
        email VARCHAR(255),
        plan VARCHAR(30) DEFAULT 'trial',
        tier INTEGER DEFAULT 0,
        current_module VARCHAR(20) DEFAULT 'self',
        current_week INTEGER DEFAULT 1,
        current_day INTEGER DEFAULT 1,
        self_week_completed INTEGER DEFAULT 0,
        money_unlocked BOOLEAN DEFAULT FALSE,
        relationship_unlocked BOOLEAN DEFAULT FALSE,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `;

    // Sessions table - one per student per module per week per day
    await sql`
      CREATE TABLE IF NOT EXISTS sessions (
        id SERIAL PRIMARY KEY,
        student_id VARCHAR(10) NOT NULL,
        module VARCHAR(20) NOT NULL,
        week INTEGER NOT NULL,
        day INTEGER NOT NULL DEFAULT 1,
        session_date DATE NOT NULL DEFAULT CURRENT_DATE,
        session_notes TEXT,
        questions_today INTEGER DEFAULT 0,
        day_complete BOOLEAN DEFAULT FALSE,
        week_complete BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(student_id, module, week, session_date)
      )
    `;

    // Messages table
    await sql`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        session_id INTEGER REFERENCES sessions(id),
        role VARCHAR(20) NOT NULL,
        content TEXT NOT NULL,
        question_number INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    return res.status(200).json({ success: true, message: 'Tables ready - fresh start' });
  } catch (error) {
    console.error('Setup error:', error);
    return res.status(500).json({ error: error.message });
  }
}
