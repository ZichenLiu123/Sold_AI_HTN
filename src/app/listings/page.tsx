import { Dashboard } from "@/components/Dashboard";
import { asSellerPage } from "@/lib/api";
import { listListings } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ListingsPage() {
  return asSellerPage(async () => (
    <Dashboard listings={await listListings()} />
  ));
}
