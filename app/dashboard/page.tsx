import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export default async function Dashboard() {
  const session = await getServerSession(authOptions);

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">
          Welcome, {session?.user?.name || "User"}!
        </h1>
        <p className="mt-2 text-gray-600">
          Your AI-powered roleplay chat platform
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* Characters Card */}
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Characters</h2>
            <span className="rounded-full bg-blue-100 px-3 py-1 text-sm font-medium text-blue-800">
              0
            </span>
          </div>
          <p className="mb-4 text-sm text-gray-600">
            Create and manage your AI characters
          </p>
          <button className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
            Create Character
          </button>
        </div>

        {/* Chats Card */}
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Chats</h2>
            <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-800">
              0
            </span>
          </div>
          <p className="mb-4 text-sm text-gray-600">
            Start conversations with your characters
          </p>
          <button className="w-full rounded-md bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700">
            New Chat
          </button>
        </div>

        {/* Settings Card */}
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Settings</h2>
            <span className="rounded-full bg-purple-100 px-3 py-1 text-sm font-medium text-purple-800">
              New
            </span>
          </div>
          <p className="mb-4 text-sm text-gray-600">
            Configure API keys and preferences
          </p>
          <button className="w-full rounded-md bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700">
            Configure
          </button>
        </div>
      </div>

      {/* Phase Status */}
      <div className="mt-8 rounded-lg border border-blue-200 bg-blue-50 p-6">
        <h3 className="mb-2 text-lg font-semibold text-blue-900">
          Phase 0: Foundation
        </h3>
        <p className="text-sm text-blue-700">
          OAuth authentication is now working! Next phases will add API key management,
          character creation, and chat functionality.
        </p>
      </div>
    </div>
  );
}
