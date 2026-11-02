import { getServerSession, type NextAuthOptions } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { controlDb, assertTenantDatabase } from "./db";
import { bindTenantDatabase } from "./tenancy";
import { canManage, hash } from "./security";
import { headers } from "next/headers";
export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      name: "Email and password",
      credentials: { email: {}, password: {} },
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) return null;
        const email = credentials.email.toLowerCase().trim();
        await rateLimit("login:" + hash(email), 15);
        const user = await controlDb.user.findUnique({ where: { email } });
        if (!user || !(await compare(credentials.password, user.passwordHash)))
          return null;
        if (user.requiresVerification && !user.emailVerifiedAt) return null;
        return { id: user.id, name: user.name, email: user.email };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.sessionVersion = (
          await controlDb.user.findUnique({
            where: { id: user.id },
            select: { sessionVersion: true },
          })
        )?.sessionVersion;
      } else if (token.sub) {
        const current = await controlDb.user.findUnique({
          where: { id: token.sub },
          select: { sessionVersion: true },
        });
        if (!current || current.sessionVersion !== (token.sessionVersion ?? 0))
          delete token.sub;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) (session.user as { id?: string }).id = token.sub;
      return session;
    },
  },
};
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function currentUser() {
  const session = await getServerSession(authOptions);
  const id = (session?.user as { id?: string } | undefined)?.id;
  const user = id
    ? await controlDb.user.findUnique({
        where: { id },
        select: { id: true, name: true, email: true, agencyAdmin: true },
      })
    : null;
  if (!user) throw new HttpError(401, "Please sign in");
  return user;
}
export async function tenant(workspaceId: string, manage = false) {
  const user = await currentUser();
  const membership = await controlDb.membership.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: user.id } },
  });
  const role = user.agencyAdmin ? "AGENCY_ADMIN" : membership?.role;
  if (!role || (manage && !canManage(role)))
    throw new HttpError(403, "Workspace access denied");
  const workspace = await controlDb.workspace.findUnique({
    where: { id: workspaceId },
  });
  if (!workspace) throw new HttpError(404, "Workspace not found");
  if (workspace.status !== "ACTIVE" && !user.agencyAdmin)
    throw new HttpError(
      403,
      "This business account is suspended. Contact the platform administrator.",
    );
  await assertTenantDatabase();
  bindTenantDatabase(workspaceId);
  return { user, role, workspace };
}
export async function sameOrigin() {
  const h = await headers();
  const origin = h.get("origin");
  if (
    !origin ||
    origin !==
      new URL(process.env.NEXTAUTH_URL || "http://localhost:3100").origin
  )
    throw new HttpError(403, "Invalid request origin");
}
export async function rateLimit(key: string, limit: number, minutes = 15) {
  const bucket = `${key}:${Math.floor(Date.now() / (minutes * 60000))}`;
  const record = await controlDb.rateBucket.upsert({
    where: { key: bucket },
    create: { key: bucket, expiresAt: new Date(Date.now() + minutes * 60000) },
    update: { count: { increment: 1 } },
  });
  if (record.count > limit)
    throw new HttpError(429, "Too many requests; please try later");
}
