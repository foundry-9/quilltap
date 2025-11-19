'use client';

import { useSession } from 'next-auth/react';
import DashboardNav from './dashboard/nav';

export default function NavWrapper() {
  const { data: session } = useSession();

  if (!session) {
    return null;
  }

  return <DashboardNav user={session.user} />;
}
