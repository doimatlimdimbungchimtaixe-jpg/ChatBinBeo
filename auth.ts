import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// Google OAuth is only registered when credentials exist, so the app still
// builds and runs (guest mode) without any env configured.
const hasGoogleCreds = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

if (!process.env.AUTH_SECRET) {
  // Never throws at import time: the app (and its build) must work in guest
  // mode without env. Production without AUTH_SECRET gets insecure,
  // non-persistent sessions — README mandates setting it.
  console.warn("[ChatBinBeo] AUTH_SECRET missing — using dev-only fallback. Set AUTH_SECRET for production.");
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: process.env.AUTH_SECRET || "dev-only-insecure-secret-change-me",
  providers: hasGoogleCreds ? [Google] : [],
  callbacks: {
    // Stable per-account id used as conversation owner (never from client input).
    async jwt({ token, account }) {
      if (account?.providerAccountId) {
        (token as Record<string, unknown>).uid = account.providerAccountId;
      }
      return token;
    },
    async session({ session, token }) {
      const uid = (token as Record<string, unknown>).uid;
      if (session.user && typeof uid === "string") {
        (session.user as unknown as Record<string, unknown>).id = uid;
      }
      return session;
    },
  },
});
