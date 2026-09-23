"use client";

import Link from "next/link";
import { WaitlistForm } from "./WaitlistForm";
import { MarketingHero } from "./MarketingHero";
import { AgentProcess } from "./AgentProcess";
import { SoldMark } from "./SoldMark";

export function MarketingPage() {
  return (
    <div data-marketing className="marketing bg-paper text-ink">
      <header className="safe-top marketing-nav">
        <div className="page-wide flex h-16 items-center justify-between">
          <SoldMark large />
          <div className="flex items-center gap-2">
            <a
              href="#agents"
              className="hidden text-[13px] font-medium text-grey hover:text-ink sm:inline"
            >
              How it works
            </a>
            <Link href="/login" className="btn-primary h-9 px-4 text-[13px]">
              Sign in
            </Link>
          </div>
        </div>
      </header>

      <MarketingHero />

      <section className="marketing-story">
        <div className="page marketing-story__inner">
          <p className="marketing-label">Why Sold</p>
          <h2 className="marketing-heading">
            Selling is work.
            <br />
            That&apos;s the product.
          </h2>
          <div className="marketing-story__grid">
            <p className="marketing-copy">
              Most closet stuff would sell. What stops people isn&apos;t the money —
              it&apos;s identifying the item, looking up comps, writing the post,
              publishing it, and answering every lowball.
            </p>
            <p className="marketing-copy marketing-copy--strong">
              Sold is a team of AI agents for that sequence. You take the photo,
              approve the listing, and set a floor. They do the rest — without
              inventing a price or sending a reply you didn&apos;t allow.
            </p>
          </div>
        </div>
      </section>

      <AgentProcess />

      <section className="marketing-proof">
        <div className="page marketing-proof__inner">
          <p className="marketing-label">Control</p>
          <h2 className="marketing-heading">You keep the floor.</h2>
          <ul className="marketing-proof__list">
            <li>No invented prices — an ask needs live comps with real URLs.</li>
            <li>
              Live means a public listing URL. Submitted is not the same thing.
            </li>
            <li>
              Negotiator drafts stay behind your floor. Nothing auto-sends.
            </li>
            <li>Passwords aren&apos;t stored. Nothing posts until you approve.</li>
          </ul>
        </div>
      </section>

      <section className="marketing-cta">
        <div className="page marketing-cta__inner">
          <h2 className="marketing-heading">Free while we&apos;re in beta</h2>
          <p className="marketing-copy mt-4 max-w-[28rem]">
            Try the agents on a real item now — or leave an email for when paid
            seats open.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-start">
            <WaitlistForm />
            <Link href="/login" className="btn-secondary shrink-0">
              Open app
            </Link>
          </div>
        </div>
      </section>

      <footer className="marketing-footer">
        <div className="page flex flex-col gap-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[1.125rem] font-semibold tracking-tight text-ink">
              Sold
            </p>
            <p className="mt-2 max-w-[28ch] text-[13px] leading-relaxed text-grey">
              AI agents that price, write, post, and draft replies — nothing goes
              live without a real listing URL.
            </p>
          </div>
          <p className="text-[12px] text-grey">
            © {new Date().getFullYear()} Sold
          </p>
        </div>
      </footer>
    </div>
  );
}
