import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import packageJson from "@/package.json";

export default async function Dashboard() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;

  // Get counts for each card
  const [charactersCount, chatsCount, personasCount] = await Promise.all([
    userId ? prisma.character.count({ where: { userId } }) : 0,
    userId ? prisma.chat.count({ where: { userId } }) : 0,
    userId ? prisma.persona.count({ where: { userId } }) : 0,
  ]);

  // Get recent chats (5 most recent, ordered by updatedAt)
  const recentChats = userId
    ? await prisma.chat.findMany({
        where: { userId },
        orderBy: { updatedAt: "desc" },
        take: 5,
        include: {
          character: true,
          persona: true,
        },
      })
    : [];

  // Get current year for copyright
  const currentYear = new Date().getFullYear();
  const copyrightYear = currentYear > 2025 ? `2025-${currentYear}` : "2025";

  return (
    <div className="container mx-auto px-4 py-8 min-h-screen flex flex-col">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
          Welcome, {session?.user?.name || "User"}!
        </h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">
          Your AI-powered roleplay chat platform
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* Characters Card */}
        <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm dark:shadow-lg">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Characters</h2>
            <span className="rounded-full bg-blue-100 dark:bg-blue-900 px-3 py-1 text-sm font-medium text-blue-800 dark:text-blue-200">
              {charactersCount}
            </span>
          </div>
          <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
            Create and manage your AI characters
          </p>
          <button className="w-full rounded-md bg-blue-600 dark:bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 dark:hover:bg-blue-800">
            Create Character
          </button>
        </div>

        {/* Chats Card */}
        <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm dark:shadow-lg">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Chats</h2>
            <span className="rounded-full bg-green-100 dark:bg-green-900 px-3 py-1 text-sm font-medium text-green-800 dark:text-green-200">
              {chatsCount}
            </span>
          </div>
          <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
            Start conversations with your characters
          </p>
          <button className="w-full rounded-md bg-green-600 dark:bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 dark:hover:bg-green-800">
            New Chat
          </button>
        </div>

        {/* Personas Card */}
        <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm dark:shadow-lg">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Personas</h2>
            <span className="rounded-full bg-purple-100 dark:bg-purple-900 px-3 py-1 text-sm font-medium text-purple-800 dark:text-purple-200">
              {personasCount}
            </span>
          </div>
          <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
            Manage your user personas
          </p>
          <button className="w-full rounded-md bg-purple-600 dark:bg-purple-700 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 dark:hover:bg-purple-800">
            Create Persona
          </button>
        </div>
      </div>

      {/* Recent Chats */}
      <div className="mt-8 flex-grow">
        <h3 className="mb-4 text-xl font-semibold text-gray-900 dark:text-white">
          Recent Chats
        </h3>
        {recentChats.length > 0 ? (
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {recentChats.map((chat: typeof recentChats[0]) => (
              <Link
                key={chat.id}
                href={`/chats/${chat.id}`}
                className="block rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 shadow-sm dark:shadow-lg hover:border-blue-500 dark:hover:border-blue-500 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-grow">
                    <h4 className="font-semibold text-gray-900 dark:text-white">
                      {chat.title}
                    </h4>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                      with {chat.character.name}
                      {chat.persona && ` as ${chat.persona.name}`}
                    </p>
                  </div>
                  <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap ml-4">
                    {new Date(chat.updatedAt).toLocaleDateString()}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-8 text-center shadow-sm dark:shadow-lg">
            <p className="text-gray-600 dark:text-gray-400">
              No chats yet. Create a character and start your first conversation!
            </p>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="mt-8 pt-6 border-t border-gray-200 dark:border-slate-700">
        <div className="flex flex-wrap items-center justify-center gap-4 text-sm text-gray-600 dark:text-gray-400">
          <span>v{packageJson.version}</span>
          <span className="hidden sm:inline">•</span>
          <a
            href="https://github.com/foundry-9/quilltap/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
          >
            <svg
              className="w-5 h-5"
              fill="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                clipRule="evenodd"
              />
            </svg>
            GitHub
          </a>
          <span className="hidden sm:inline">•</span>
          <a
            href="https://github.com/foundry-9/quilltap/blob/main/LICENSE"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
          >
            Free Software - MIT License
          </a>
          <span className="hidden sm:inline">•</span>
          <a
            href="https://foundry-9.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
          >
            &copy; {copyrightYear} Foundry-9
          </a>
        </div>
      </footer>
    </div>
  );
}
