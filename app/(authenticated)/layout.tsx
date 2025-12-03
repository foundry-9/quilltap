import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";

export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession();

  if (!session) {
    redirect("/auth/signin");
  }

  return children;
}
