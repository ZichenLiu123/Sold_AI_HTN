import Link from "next/link";

export function SoldMark({
  large = false,
  href = "/",
}: {
  large?: boolean;
  href?: string;
}) {
  return (
    <Link
      href={href}
      className={`sold-mark inline-flex items-baseline text-ink ${
        large ? "sold-mark--lg" : ""
      }`}
      aria-label="Sold home"
    >
      Sold
    </Link>
  );
}
