import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  try {
    const sql = neon(process.env.DATABASE_URL);

    // Students table
    // plan: 'trial' | 'self' | 'self_money' | 'self_relationship' | 'all'
    // tier: 0=免費試用 1=純App 2=App+Live 3=App+Live+1對1 4=SC日記訂閱
    await sql`
      CREATE TABLE IF NOT EXISTS students (
        id SERIAL PRIMARY KEY,
        student_id VARCHAR(10) UNIQUE NOT NULL,
        email VARCHAR(255),
        plan VARCHAR(30) DEFAULT 'trial',
        tier INTEGER DEFAULT 0,
        self_week INTEGER DEFAULT 1,
        money_week INTEGER DEFAULT 0,
        relationship_week INTEGER DEFAULT 0,
        self_complete BOOLEAN DEFAULT FALSE,
        money_complete BOOLEAN DEFAULT FALSE,
        relationship_complete BOOLEAN DEFAULT FALSE,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `;

    // Sessions table
    // module: 'self' | 'money' | 'relationship'
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

    return res.status(200).json({ success: true, message: 'Tables ready' });
  } catch (error) {
    console.error('Setup error:', error);
    return res.status(500).json({ error: error.message });
  }
}
