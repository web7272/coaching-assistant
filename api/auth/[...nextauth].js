import NextAuth from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';

const ALLOWED_EMAIL = process.env.COACH_EMAIL;

export default NextAuth({
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      // 只允許你的 email 登入後台
      if (ALLOWED_EMAIL && user.email !== ALLOWED_EMAIL) {
        return false;
      }
      return true;
    },
    async session({ session }) {
      return session;
    },
  },
  pages: {
    signIn: '/coach-login',
    error: '/coach-login',
  },
});
