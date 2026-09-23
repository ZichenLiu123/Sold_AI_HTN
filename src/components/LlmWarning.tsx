"use client";

import { useEffect, useState } from "react";

export function LlmWarning() {
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    fetch("/api/status")
      .then((response) => response.json())
      .then((data) => setMissing(Boolean(data && data.llm === false)))
      .catch(() => setMissing(false));
  }, []);

  if (!missing) return null;

  return (
    <p className="border-t border-line bg-wash/80 px-5 py-2 text-center text-[12px] text-grey">
      Add <span className="font-medium text-ink">OPENAI_API_KEY</span> or{" "}
      <span className="font-medium text-ink">ANTHROPIC_API_KEY</span> in{" "}
      <span className="font-medium text-ink">.env.local</span> to run the agents.
    </p>
  );
}
