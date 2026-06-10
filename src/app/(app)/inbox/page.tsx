/**
 * Inbox — server component shell (auth only); data is fetched client-side
 * with polling from /api/conversations (tenant-filtered in the API).
 */
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { InboxClient } from "./inbox-client";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col space-y-4">
      <h1 className="font-display text-2xl font-semibold">Inbox</h1>
      <InboxClient />
    </div>
  );
}
