"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

export default function AuthError() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800">
      <div className="w-full max-w-md space-y-8 rounded-lg bg-white p-10 shadow-xl">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-red-600">Authentication Error</h1>
          <p className="mt-2 text-sm text-gray-600">
            Something went wrong during sign in
          </p>
        </div>

        <div className="rounded-md bg-red-50 p-4">
          <p className="text-sm text-red-700">
            {error === "Configuration" && "There is a problem with the server configuration."}
            {error === "AccessDenied" && "You do not have permission to sign in."}
            {error === "Verification" && "The sign in link is no longer valid."}
            {!error && "An unknown error occurred."}
          </p>
        </div>

        <div className="text-center">
          <Link
            href="/auth/signin"
            className="text-sm font-semibold text-blue-600 hover:text-blue-500"
          >
            Try again
          </Link>
        </div>
      </div>
    </div>
  );
}
