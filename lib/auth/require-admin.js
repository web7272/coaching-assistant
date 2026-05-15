// lib/auth/require-admin.js
// v4.0 Phase 7：admin endpoint 簡易 auth（blocker 3 b 落地、env var token check）
//
// 設計：
// - check req.headers['x-admin-token'] || req.query.token 是否等於 process.env.ADMIN_TOKEN
// - 若 ADMIN_TOKEN env 沒設、console.error + return null（拒絕全部、防 prod 漏設）
// - 若 token 對、return stub user { email: 'admin@seeyourself.local' }（給 feature_flag_audit 寫入 changed_by 用）
//
// ⚠️ Vivi 必須在 Vercel dashboard 設 ADMIN_TOKEN env var（隨機 32 char）、否則 admin endpoint 全部 401。
// ⚠️ Token 不放 git、不放 .env（local dev 可放 .env.local、注意 .gitignore 涵蓋）。

export async function requireAdmin(req) {
  const expectedToken = process.env.ADMIN_TOKEN;
  if (!expectedToken) {
    console.error('[require-admin] ADMIN_TOKEN env var not set — all admin requests will fail. Set it in Vercel dashboard.');
    return null;
  }
  const token = req.headers?.['x-admin-token'] || req.query?.token;
  if (!token || token !== expectedToken) return null;
  return { email: 'admin@seeyourself.local' };
}
