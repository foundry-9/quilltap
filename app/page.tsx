import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";

export default async function Home() {
  const session = await getServerSession(authOptions);

  if (session) {
    redirect("/dashboard");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800 p-24">
      <div className="text-center">
        <h1 className="text-5xl font-bold text-white mb-4">Welcome to Quilltap</h1>
        <p className="text-xl text-slate-300 mb-8">
          AI-powered roleplay chat platform with multi-provider support
        </p>
        <div className="flex gap-4 justify-center">
          <Link
            href="/auth/signin"
            className="rounded-lg bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-lg hover:bg-blue-700 transition"
          >
            Get Started
          </Link>
          <a
            href="https://github.com/foundry-9/quilltap"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg bg-slate-700 px-6 py-3 text-sm font-semibold text-white shadow-lg hover:bg-slate-600 transition"
          >
            Learn More
          </a>
        </div>
        <p className="mt-8 text-sm text-slate-400">
          Phase 0: Foundation - OAuth Authentication Complete
        </p>
      </div>
    </main>
  );
}
