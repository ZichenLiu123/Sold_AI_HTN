"use client";

import { useEffect, useState } from "react";

type StampSize = "sm" | "md" | "lg" | "hero" | "mark" | "closing";

const SIZE: Record<StampSize, string> = {
  sm: "rubber-stamp--sm",
  md: "rubber-stamp--md",
  lg: "rubber-stamp--lg",
  hero: "rubber-stamp--hero",
  mark: "rubber-stamp--mark",
  closing: "rubber-stamp--closing",
};

export function RubberStamp({
  label = "Verified",
  size = "md",
  animate = false,
  delayMs = 0,
  rotate,
  className = "",
}: {
  label?: string;
  size?: StampSize;
  /** Play the press-down hit once after delay */
  animate?: boolean;
  delayMs?: number;
  /** Degrees; omit for a stable default per size */
  rotate?: number;
  className?: string;
}) {
  const [hit, setHit] = useState(!animate);
  const rot = rotate ?? (size === "mark" ? -3.5 : size === "hero" ? -5 : -4);
  const isWordmark = className.includes("rubber-stamp--wordmark") || className.includes("rubber-stamp--closing");

  useEffect(() => {
    if (!animate) return;
    setHit(false);
    const timer = window.setTimeout(() => setHit(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [animate, delayMs]);

  return (
    <span
      className={`rubber-stamp ${SIZE[size]} ${hit ? "is-hit" : ""} ${isWordmark ? "rubber-stamp--static" : ""} ${className}`}
      style={{ ["--stamp-rot" as string]: `${rot}deg` }}
      aria-hidden={label === "Sold" ? true : undefined}
    >
      <span className="rubber-stamp__ink">{label}</span>
    </span>
  );
}

/** Intersection-triggered stamp for mid-page verification moments */
export function StampOnView({
  label = "Live",
  size = "md",
  rotate = -4,
  className = "",
}: {
  label?: string;
  size?: StampSize;
  rotate?: number;
  className?: string;
}) {
  const [ready, setReady] = useState(false);
  const [node, setNode] = useState<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!node) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setReady(true);
          io.disconnect();
        }
      },
      { threshold: 0.55 }
    );
    io.observe(node);
    return () => io.disconnect();
  }, [node]);

  return (
    <span ref={setNode} className={`inline-flex ${className}`}>
      <RubberStamp
        label={label}
        size={size}
        rotate={rotate}
        animate={ready}
        delayMs={120}
      />
    </span>
  );
}
