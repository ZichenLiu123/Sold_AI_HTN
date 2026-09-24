"use client";

import Link from "next/link";
import { HeroDemo } from "./HeroDemo";

export function MarketingHero() {
  return (
    <section className="marketing-hero">
      <div className="page-wide marketing-hero__inner">
        <div className="marketing-hero__copy">
          <p className="marketing-label">Marketplace selling, finished</p>
          <h1 className="marketing-hero__title">
            Take the picture.
            <br />
            Sold does the rest.
          </h1>
          <p className="marketing-hero__lede">
            AI agents that identify what you photographed, price it from live
            listings, post it, and draft buyer replies — you keep the floor.
          </p>
          <div className="marketing-hero__actions">
            <Link href="/login" className="btn-primary marketing-hero__cta">
              Get started
            </Link>
            <a href="#agents" className="btn-secondary marketing-hero__cta">
              How it works
            </a>
          </div>
        </div>

        <div className="marketing-hero__demo">
          <HeroDemo />
        </div>
      </div>
    </section>
  );
}
