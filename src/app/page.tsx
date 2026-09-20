import { Dashboard } from "@/components/Dashboard";
import { listListings } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  return <Dashboard listings={await listListings()} />;
}
