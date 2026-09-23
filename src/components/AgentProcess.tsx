"use client";

const PHASES = [
  {
    label: "Identify",
    title: "See it. Price it.",
    body: "Vision reads brand, model, size, condition, and flaws. Pricing keeps only live comps with real listing URLs — no URL, no suggested ask.",
  },
  {
    label: "Publish",
    title: "Write it. Post it.",
    body: "A listing draft you can edit, then browser agents publish to Facebook, Kijiji, OfferUp, Craigslist, Mercari, Poshmark, and eBay — only after you approve.",
  },
  {
    label: "Reply",
    title: "Prove it. Answer it.",
    body: "Live means a public URL on file. The negotiator drafts behind your floor. You stamp accepts — nothing auto-sends.",
  },
] as const;

export function AgentProcess() {
  return (
    <section id="agents" className="agent-process">
      <div className="page">
        <p className="marketing-label">How it works</p>
        <h2 className="marketing-heading">Three steps. One photo.</h2>
        <p className="marketing-copy mt-4 max-w-[32rem]">
          Identify, publish, and reply — with the parts Sold refuses to fake.
        </p>

        <div className="agent-process__grid">
          {PHASES.map((phase, index) => (
            <article key={phase.label} className="agent-process__phase">
              <p className="agent-process__index" aria-hidden>
                {String(index + 1).padStart(2, "0")}
              </p>
              <p className="agent-process__tag">{phase.label}</p>
              <h3 className="agent-process__title">{phase.title}</h3>
              <p className="agent-process__body">{phase.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
