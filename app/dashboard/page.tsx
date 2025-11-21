import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { RecentChatsSection } from "@/components/dashboard/recent-chats";
import { FavoriteCharactersSection } from "@/components/dashboard/favorite-characters";

export default async function Dashboard() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;

  // Get counts for each card
  const [charactersCount, chatsCount, personasCount] = await Promise.all([
    userId ? prisma.character.count({ where: { userId } }) : 0,
    userId ? prisma.chat.count({ where: { userId } }) : 0,
    userId ? prisma.persona.count({ where: { userId } }) : 0,
  ]);

  // Get favorite characters
  const favoriteCharacters = userId
    ? await prisma.character.findMany({
        where: { userId, isFavorite: true },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          avatarUrl: true,
          defaultImageId: true,
          defaultImage: true,
        },
      })
    : [];

  // Get recent chats (5 most recent, ordered by updatedAt)
  const recentChats = userId
    ? await prisma.chat.findMany({
        where: { userId },
        orderBy: { updatedAt: "desc" },
        take: 5,
        include: {
          character: {
            include: {
              defaultImage: true,
            },
          },
          persona: true,
          tags: {
            include: {
              tag: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      })
    : [];

  return (
    <div className="container mx-auto px-4 py-8 flex flex-col max-w-[800px]">
      <div className="flex-1">
        {/* Show favorite characters section if there are any favorites */}
        {favoriteCharacters.length > 0 ? (
          <FavoriteCharactersSection characters={favoriteCharacters} />
        ) : (
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              Welcome, {session?.user?.name || "User"}!
            </h1>
            <p className="mt-2 text-gray-600 dark:text-gray-400">
              Your AI-powered roleplay chat platform
            </p>
          </div>
        )}

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 mt-8">
        {/* Characters Card */}
        <Link href="/characters">
          <div className="h-full flex flex-col rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm dark:shadow-lg hover:border-blue-500 hover:shadow-md dark:hover:border-blue-500 dark:hover:shadow-md transition-all cursor-pointer">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Characters</h2>
              <span className="rounded-full bg-blue-100 dark:bg-blue-900 px-3 py-1 text-sm font-medium text-blue-800 dark:text-blue-200">
                {charactersCount}
              </span>
            </div>
            <p className="mb-6 flex-1 text-sm text-gray-600 dark:text-gray-400">
              Create and manage your AI characters
            </p>
            <div className="w-full rounded-md bg-blue-600 dark:bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 dark:hover:bg-blue-800 text-center">
              Manage Characters
            </div>
          </div>
        </Link>

        {/* Chats Card */}
        <Link href="/chats">
          <div className="h-full flex flex-col rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm dark:shadow-lg hover:border-green-500 hover:shadow-md dark:hover:border-green-500 dark:hover:shadow-md transition-all cursor-pointer">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Chats</h2>
              <span className="rounded-full bg-green-100 dark:bg-green-900 px-3 py-1 text-sm font-medium text-green-800 dark:text-green-200">
                {chatsCount}
              </span>
            </div>
            <p className="mb-6 flex-1 text-sm text-gray-600 dark:text-gray-400">
              Start conversations with your characters
            </p>
            <div className="w-full rounded-md bg-green-600 dark:bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 dark:hover:bg-green-800 text-center">
              Manage Chats
            </div>
          </div>
        </Link>

        {/* Personas Card */}
        <Link href="/personas">
          <div className="h-full flex flex-col rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm dark:shadow-lg hover:border-purple-500 hover:shadow-md dark:hover:border-purple-500 dark:hover:shadow-md transition-all cursor-pointer">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Personas</h2>
              <span className="rounded-full bg-purple-100 dark:bg-purple-900 px-3 py-1 text-sm font-medium text-purple-800 dark:text-purple-200">
                {personasCount}
              </span>
            </div>
            <p className="mb-6 flex-1 text-sm text-gray-600 dark:text-gray-400">
              Manage your user personas
            </p>
            <div className="w-full rounded-md bg-purple-600 dark:bg-purple-700 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 dark:hover:bg-purple-800 text-center">
              Manage Personas
            </div>
          </div>
        </Link>
      </div>

        {/* Recent Chats */}
        <RecentChatsSection chats={recentChats} />
      </div>
    </div>
  );
}
