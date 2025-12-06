import { getServerSession } from "@/lib/auth/session";
import { getRepositories } from "@/lib/repositories/factory";
import Link from "next/link";
import { RecentChatsSection } from "@/components/dashboard/recent-chats";
import { FavoriteCharactersSection } from "@/components/dashboard/favorite-characters";
import type { FileEntry } from "@/lib/schemas/types";

/**
 * Get the filepath for a file based on storage type
 */
function getFilePath(file: FileEntry): string {
  if (file.s3Key) {
    return `/api/files/${file.id}`;
  }
  const ext = file.originalFilename.includes('.')
    ? file.originalFilename.substring(file.originalFilename.lastIndexOf('.'))
    : '';
  return `data/files/storage/${file.id}${ext}`;
}

// Revalidate dashboard on every request to show latest character data
export const revalidate = 0;

export default async function Dashboard() {
  const session = await getServerSession();
  const repos = getRepositories();

  // Get the user from the repository
  const user = session?.user?.email
    ? await repos.users.findByEmail(session.user.email)
    : null;
  const userId = user?.id;

  // Get all characters, chats, and personas for counts
  const [allCharacters, allChats, allPersonas] = await Promise.all([
    userId ? repos.characters.findAll() : Promise.resolve([]),
    userId ? repos.chats.findAll() : Promise.resolve([]),
    userId ? repos.personas.findAll() : Promise.resolve([]),
  ]);

  // Count items (single-user system, but filter by userId for consistency)
  const charactersCount = allCharacters.length;
  const chatsCount = allChats.length;
  const personasCount = allPersonas.length;

  // Get favorite characters
  const favoriteCharacters = userId
    ? await Promise.all(
        allCharacters
          .filter((c) => c.isFavorite)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .map(async (character) => {
            // Get default image from repository if exists
            let defaultImage = null;
            if (character.defaultImageId) {
              const fileEntry = await repos.files.findById(character.defaultImageId);
              if (fileEntry) {
                defaultImage = {
                  id: fileEntry.id,
                  filepath: getFilePath(fileEntry),
                  url: null,
                };
              }
            }
            return {
              id: character.id,
              name: character.name,
              title: character.title ?? null,
              avatarUrl: character.avatarUrl ?? null,
              defaultImageId: character.defaultImageId ?? null,
              defaultImage,
              tags: character.tags ?? [],
            };
          })
      )
    : [];

  // Get recent chats (5 most recent, ordered by updatedAt)
  const allRecentChats: Array<{
    id: string
    title: string
    updatedAt: string
    messageCount: number
    character: {
      name: string
      avatarUrl: string | null
      defaultImageId: string | null
      defaultImage: { id: string; filepath: string; url: null } | null
    }
    persona: { id: string; name: string } | null
    tags: Array<{ tag: { id: string; name: string } }>
  } | null> = userId
    ? await Promise.all(
        [...allChats]
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
          .slice(0, 5)
          .map(async (chat) => {
            // Get character from participants
            const characterParticipant = chat.participants.find(
              p => p.type === 'CHARACTER' && p.characterId
            );
            if (!characterParticipant?.characterId) return null;

            const character = await repos.characters.findById(characterParticipant.characterId);
            // Skip chats without characters
            if (!character) return null;

            let characterDefaultImage = null;
            if (character.defaultImageId) {
              const fileEntry = await repos.files.findById(character.defaultImageId);
              if (fileEntry) {
                characterDefaultImage = {
                  id: fileEntry.id,
                  filepath: getFilePath(fileEntry),
                  url: null,
                };
              }
            }

            // Get persona data from participants if present
            let persona = null;
            const personaParticipant = chat.participants.find(
              p => p.type === 'PERSONA' && p.personaId
            );
            if (personaParticipant?.personaId) {
              persona = await repos.personas.findById(personaParticipant.personaId);
            }

            // Get tags
            const tagData = await Promise.all(
              chat.tags.map(async (tagId) => {
                const tag = await repos.tags.findById(tagId);
                return tag ? { tag: { id: tag.id, name: tag.name } } : null;
              })
            );

            return {
              id: chat.id,
              title: chat.title,
              updatedAt: chat.updatedAt,
              messageCount: chat.messageCount || 0,
              character: {
                name: character.name,
                avatarUrl: character.avatarUrl ?? null,
                defaultImageId: character.defaultImageId ?? null,
                defaultImage: characterDefaultImage,
              },
              persona: persona
                ? {
                    id: persona.id,
                    name: persona.name,
                  }
                : null,
              tags: tagData.filter((tag): tag is { tag: { id: string; name: string } } => tag !== null),
            };
          })
      )
    : [];

  const recentChats = allRecentChats.filter((chat) => chat !== null);

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
