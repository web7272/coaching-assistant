import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  try {
    const sql = neon(process.env.DATABASE_URL);
    
    await sql`
      CREATE TABLE IF NOT EXISTS sessions (
        id SERIAL PRIMARY KEY,
        student_name VARCHAR(100) NOT NULL,
        module VARCHAR(50) NOT NULL,
        week INTEGER NOT NULL,
        session_notes TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `;

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

    return res.status(200).json({ success: true, message: 'Tables created' });
  } catch (error) {
    console.error('Setup error:', error);
    return res.status(500).json({ error: error.message });
  }
}
