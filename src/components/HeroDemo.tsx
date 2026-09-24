"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { RubberStamp } from "./RubberStamp";

type Phase = "identify" | "post" | "reply";

const PHASES: Phase[] = ["identify", "post", "reply"];

const BEAT: Record<
  Phase,
  {
    label: string;
    caption: string;
    dwell: number;
  }
> = {
  identify: {
    label: "Identify",
    caption: "Reads the photo, then prices from live comps.",
    dwell: 5800,
  },
  post: {
    label: "Post",
    caption: "Goes live only with a public listing URL.",
    dwell: 5200,
  },
  reply: {
    label: "Reply",
    caption: "Drafts stay behind your floor — you send.",
    dwell: 5400,
  },
};

/** Anchor dots on the camera; labels float off the body. */
const PINS = [
  {
    id: "shutter",
    label: "Red shutter",
    detail: "Like new",
    x: 37.5,
    y: 54.5,
    align: "left" as const,
  },
  {
    id: "lens",
    label: "OneStep 2",
    detail: "i-Type",
    x: 50.5,
    y: 43,
    align: "right" as const,
  },
  {
    id: "brand",
    label: "Polaroid",
    detail: "Original body",
    x: 45.5,
    y: 71,
    align: "left" as const,
  },
] as const;

const MARKETS = [
  { name: "Facebook", url: "facebook.com/marketplace/item/…" },
  { name: "Kijiji", url: "kijiji.ca/v-…/…" },
  { name: "Karrot", url: "karrotmarket.com/ca/buy-sell/…" },
  { name: "OfferUp", url: "offerup.com/item/detail/…" },
] as const;

const AGENT_LINES: Record<Phase, string[]> = {
  identify: ["Reading the photo", "Citing live comps"],
  post: ["Posting to Facebook", "Posting to Kijiji", "Posting to Karrot"],
  reply: ["Reading the offer", "Drafting a reply"],
};

export function HeroDemo() {
  const [phase, setPhase] = useState<Phase>("identify");
  const [cycle, setCycle] = useState(0);
  const [play, setPlay] = useState({ identify: 0, post: 0, reply: 0 });
  const [reduce, setReduce] = useState(false);
  const [agentLine, setAgentLine] = useState(AGENT_LINES.identify[0]);

  const phaseRef = useRef<Phase>("identify");
  const reduceRef = useRef(false);
  const phaseTimer = useRef(0);
  const agentTimers = useRef<number[]>([]);
  const beginRef = useRef<(next: Phase, dwell?: number) => void>(() => undefined);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(mq.matches);
    reduceRef.current = mq.matches;
    const onChange = () => {
      setReduce(mq.matches);
      reduceRef.current = mq.matches;
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    function clearAgentTimers() {
      for (const id of agentTimers.current) window.clearTimeout(id);
      agentTimers.current = [];
    }

    function runAgentLines(next: Phase) {
      clearAgentTimers();
      const lines = AGENT_LINES[next];
      setAgentLine(lines[0]);
      if (reduceRef.current || lines.length < 2) return;

      const dwell = BEAT[next].dwell;
      const step = dwell / (lines.length + 0.4);
      lines.slice(1).forEach((line, i) => {
        const id = window.setTimeout(() => setAgentLine(line), step * (i + 1));
        agentTimers.current.push(id);
      });
    }

    function stop() {
      window.clearTimeout(phaseTimer.current);
      clearAgentTimers();
    }

    function begin(next: Phase, nextDwell = BEAT[next].dwell) {
      const prev = phaseRef.current;
      if (next === "identify" && prev !== "identify") {
        setCycle((n) => n + 1);
      }

      phaseRef.current = next;
      setPhase(next);
      setPlay((p) => ({ ...p, [next]: p[next] + 1 }));
      runAgentLines(next);

      window.clearTimeout(phaseTimer.current);
      if (reduceRef.current) return;

      phaseTimer.current = window.setTimeout(() => {
        if (reduceRef.current) return;
        const nxt = PHASES[(PHASES.indexOf(next) + 1) % PHASES.length];
        begin(nxt);
      }, nextDwell);
    }

    beginRef.current = begin;
    begin("identify");

    return () => {
      stop();
      beginRef.current = () => undefined;
    };
  }, [reduce]);

  function goTo(step: Phase) {
    beginRef.current(step, BEAT[step].dwell);
  }

  const showIdentify = reduce || phase === "identify";
  const showPost = !reduce && phase === "post";
  const showReply = !reduce && phase === "reply";
  const showChip = !reduce && phase !== "identify";
  const current = reduce ? "identify" : phase;
  const currentIndex = PHASES.indexOf(current);
  const caption = BEAT[current].caption;
  const dwell = BEAT[current].dwell;

  return (
    <div
      className="hero-demo"
      aria-label="Sold demo: identify, post across marketplaces, draft a reply"
    >
      <div className="hero-demo__stage" data-phase={current}>
        <Image
          src="/hero-product.jpg"
          alt="Polaroid OneStep 2 i-Type camera on a white surface"
          width={1600}
          height={1067}
          priority
          className="hero-demo__photo"
        />
        <div className="hero-demo__veil" aria-hidden />

        <div className="hero-demo__agent" aria-live="polite">
          <span className="hero-demo__agent-dot" aria-hidden />
          <span key={agentLine} className="hero-demo__agent-text">
            {agentLine}
          </span>
        </div>

        <div
          className={`hero-demo__chip ${showChip ? "is-on" : "is-off"}`}
          aria-hidden={!showChip}
        >
          <span className="hero-demo__chip-name">Polaroid OneStep 2</span>
          <span className="hero-demo__chip-price">$89</span>
        </div>

        <div
          className={`hero-demo__layer hero-demo__identify ${showIdentify ? "is-on" : "is-off"}`}
          aria-hidden={!showIdentify}
        >
          <div key={`id-${cycle}-${play.identify}`} className="hero-demo__layer-inner">
            <div className="hero-demo__scan" aria-hidden />
            <div className="hero-demo__focus" aria-hidden />
            {PINS.map((pin, i) => (
              <div
                key={pin.id}
                className={`hero-demo__pin hero-demo__pin--${pin.align}`}
                style={{
                  left: `${pin.x}%`,
                  top: `${pin.y}%`,
                  ["--i" as string]: String(i),
                }}
              >
                <span className="hero-demo__pin-dot" />
                <span className="hero-demo__pin-ring" />
                <span className="hero-demo__pin-arm" />
                <span className="hero-demo__pin-label">
                  <span className="hero-demo__pin-title">{pin.label}</span>
                  <span className="hero-demo__pin-detail">{pin.detail}</span>
                </span>
              </div>
            ))}
            <div className="hero-demo__ask">
              <span className="hero-demo__ask-kicker">Suggested ask</span>
              <span className="hero-demo__ask-price">$89</span>
              <span className="hero-demo__ask-note">4 cited comps</span>
            </div>
          </div>
        </div>

        <div
          className={`hero-demo__layer hero-demo__post ${showPost ? "is-on" : "is-off"}`}
          aria-hidden={!showPost}
        >
          <div key={`post-${play.post}`} className="hero-demo__layer-inner">
            <div className="hero-demo__post-panel">
              <div className="hero-demo__post-head">
                <div>
                  <p className="hero-demo__post-kicker">Posting live</p>
                  <p className="hero-demo__post-title">Polaroid OneStep 2 i-Type</p>
                </div>
                <p className="hero-demo__post-price">$89</p>
              </div>
              <ul className="hero-demo__markets">
                {MARKETS.map((market, i) => (
                  <li
                    key={market.name}
                    className="hero-demo__market"
                    style={{ ["--i" as string]: String(i) }}
                  >
                    <div className="min-w-0">
                      <p className="hero-demo__market-name">{market.name}</p>
                      <p className="hero-demo__market-url">{market.url}</p>
                    </div>
                    <span className="hero-demo__live">Live</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="hero-demo__stamp-slot hero-demo__stamp-slot--post">
              <RubberStamp
                label="Live"
                size="md"
                animate={!reduce && phase === "post"}
                delayMs={1100}
                rotate={-7}
              />
            </div>
          </div>
        </div>

        <div
          className={`hero-demo__layer hero-demo__reply ${showReply ? "is-on" : "is-off"}`}
          aria-hidden={!showReply}
        >
          <div key={`reply-${play.reply}`} className="hero-demo__thread">
            <div className="hero-demo__bubble hero-demo__bubble--buyer">
              <p className="hero-demo__bubble-who">Buyer</p>
              <p>Still available? I can do $70 cash today.</p>
            </div>
            <div className="hero-demo__typing" aria-hidden>
              <span />
              <span />
              <span />
            </div>
            <div className="hero-demo__bubble hero-demo__bubble--agent">
              <p className="hero-demo__bubble-who">Draft · hold</p>
              <p>Still available at $89 — happy to meet this evening.</p>
              <p className="hero-demo__bubble-meta">Draft · not sent · floor held</p>
            </div>
          </div>
        </div>
      </div>

      <p className="hero-demo__caption" aria-live="polite">
        <span className="hero-demo__caption-phase">{BEAT[current].label}</span>
        <span className="hero-demo__caption-text">{caption}</span>
      </p>

      <div className="hero-demo__rail" role="tablist" aria-label="Demo steps">
        {PHASES.map((step, index) => {
          const done = index < currentIndex;
          const active = step === current;
          return (
            <button
              key={step}
              type="button"
              role="tab"
              aria-selected={active}
              className={`hero-demo__step ${active ? "is-current" : ""} ${done ? "is-done" : ""}`}
              onClick={() => goTo(step)}
            >
              <span className="hero-demo__step-index">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="hero-demo__step-body">
                <span className="hero-demo__step-label">{BEAT[step].label}</span>
                <span className="hero-demo__step-track" aria-hidden>
                  <span
                    key={active ? `${step}-${play[step]}` : `${step}-idle`}
                    className={`hero-demo__step-fill ${active && !reduce ? "is-running" : ""} ${done ? "is-complete" : ""}`}
                    style={
                      active && !reduce
                        ? { animationDuration: `${dwell}ms` }
                        : undefined
                    }
                  />
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
