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
    <p className="border-t border-line bg-wash px-4 py-2 text-center text-xs text-ink/70">
      Add an OpenAI or Anthropic key to run the agents.
    </p>
  );
}
