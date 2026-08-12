import { getServerSession } from "@/lib/auth/session";
import { getRepositories } from "@/lib/repositories/factory";
import { HomeView } from "@/components/homepage/HomeView";
import { getHomeData } from "@/lib/services/home-data.service";
import { redirectToWorkspaceTab } from "@/lib/navigation/workspace-redirect";

// Never pre-render during build - requires database access
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function Home() {
  // When the tabbed workspace is enabled, it is the post-login landing surface.
  redirectToWorkspaceTab('home');

  const session = await getServerSession();

  // In single-user mode, session is always available
  const userId = session?.user?.id;
  const repos = getRepositories();

  const { displayName, lastChatId, recentChats, projects, characters } =
    await getHomeData(repos, { userId, fallbackName: session?.user?.name });

  return (
    <HomeView
      displayName={displayName}
      lastChatId={lastChatId}
      recentChats={recentChats}
      projects={projects}
      characters={characters}
    />
  );
}
