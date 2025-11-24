import { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { verifyPassword } from "@/lib/auth/password";
import { JsonStoreAdapter } from "@/lib/json-store/auth-adapter";
import { getJsonStore } from "@/lib/json-store/core/json-store";
import { UsersRepository } from "@/lib/json-store/repositories/users.repository";

// Lazy-load repositories and adapter to allow for testing
let usersRepo: UsersRepository | null = null;
let adapter: ReturnType<typeof JsonStoreAdapter> | null = null;

function getUsersRepository(): UsersRepository {
  if (!usersRepo) {
    usersRepo = new UsersRepository(getJsonStore());
  }
  return usersRepo;
}

function getAdapter(): ReturnType<typeof JsonStoreAdapter> {
  if (!adapter) {
    adapter = JsonStoreAdapter(getJsonStore());
  }
  return adapter;
}

export const authOptions: NextAuthOptions = {
  adapter: getAdapter(),
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    CredentialsProvider({
      id: 'credentials',
      name: 'Email and Password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        totpCode: { label: '2FA Code (if enabled)', type: 'text' }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error('Email and password required')
        }

        // Find user
        const user = await getUsersRepository().findByEmail(credentials.email)

        if (!user?.passwordHash) {
          throw new Error('Invalid email or password')
        }

        // Verify password
        const valid = await verifyPassword(
          credentials.password,
          user.passwordHash
        )

        if (!valid) {
          throw new Error('Invalid email or password')
        }

        // Check if 2FA is enabled
        if (user.totp?.enabled) {
          if (!credentials.totpCode) {
            throw new Error('2FA code required')
          }

          // Verify TOTP
          const { verifyTOTP } = await import('@/lib/auth/totp')
          const totpValid = await verifyTOTP(user.id, credentials.totpCode)

          if (!totpValid) {
            throw new Error('Invalid 2FA code')
          }
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        }
      },
    }),
    // Post-1.0: Add more providers
    // AppleProvider({ ... }),
    // GitHubProvider({ ... }),
  ],
  callbacks: {
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
      }
      return session;
    },
  },
  pages: {
    signIn: '/auth/signin',
    error: '/auth/error',
  },
  session: {
    strategy: "database",
  },
  debug: process.env.NODE_ENV === "development",
};
