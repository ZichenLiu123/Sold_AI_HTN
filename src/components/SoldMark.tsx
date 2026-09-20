import Link from "next/link";

export function SoldMark() {
  return (
    <Link href="/" className="flex items-center gap-2">
      <span className="sold-mark text-[2.15rem]">Sold</span>
      <span className="stamp text-sold">AI</span>
    </Link>
  );
}
