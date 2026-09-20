import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

export type LlmImage = {
  media_type: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  data: string;
  detail?: "original" | "high" | "low";
};

export type LlmProvider = "anthropic" | "openai";

export type LlmCompletion = {
  text: string;
  urls: string[];
};

export function llmProvider(): LlmProvider | null {
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return null;
}

export function openaiModel(kind: "vision" | "text" = "text"): string {
  if (kind === "vision") {
    return (
      process.env.OPENAI_VISION_MODEL ||
      process.env.OPENAI_MODEL ||
      "gpt-5.4"
    );
  }
  return process.env.OPENAI_MODEL || "gpt-5.4";
}

export async function complete(input: {
  system: string;
  text: string;
  images?: LlmImage[];
  maxTokens: number;
  webSearch?: boolean;
}): Promise<string> {
  return (await completeDetailed(input)).text;
}

export async function completeDetailed(input: {
  system: string;
  text: string;
  images?: LlmImage[];
  maxTokens: number;
  webSearch?: boolean;
}): Promise<LlmCompletion> {
  const provider = llmProvider();
  if (!provider) {
    throw new Error(
      "No LLM key set. Add OPENAI_API_KEY or ANTHROPIC_API_KEY to .env.local."
    );
  }
  return provider === "anthropic"
    ? completeAnthropic(input)
    : completeOpenAI(input);
}

async function completeAnthropic(input: {
  system: string;
  text: string;
  images?: LlmImage[];
  maxTokens: number;
}): Promise<LlmCompletion> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const content: Anthropic.Messages.ContentBlockParam[] = [
    ...(input.images || []).map((image) => ({
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: image.media_type,
        data: image.data,
      },
    })),
    { type: "text" as const, text: input.text },
  ];
  const response = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
    max_tokens: input.maxTokens,
    system: input.system,
    messages: [{ role: "user", content }],
  });
  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
  return { text, urls: [] };
}

async function completeOpenAI(input: {
  system: string;
  text: string;
  images?: LlmImage[];
  maxTokens: number;
  webSearch?: boolean;
}): Promise<LlmCompletion> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const hasImages = Boolean(input.images?.length);
  const content: OpenAI.Responses.ResponseInputContent[] = [
    ...(input.images || []).map((image) => ({
      type: "input_image" as const,
      detail: image.detail || "high",
      image_url: `data:${image.media_type};base64,${image.data}`,
    })),
    { type: "input_text" as const, text: input.text },
  ];
  const response = await client.responses.create({
    model: openaiModel(hasImages ? "vision" : "text"),
    instructions: input.system,
    input: [{ role: "user", content }],
    max_output_tokens: input.maxTokens,
    ...(hasImages ? { text: { verbosity: "high" as const } } : {}),
    ...(input.webSearch
      ? {
          tools: [
            {
              type: "web_search" as const,
              user_location: {
                type: "approximate" as const,
                country: "US",
                city: "New York",
                region: "New York",
                timezone: "America/New_York",
              },
            },
          ],
          include: [
            "web_search_call.action.sources",
            "web_search_call.results",
          ],
        }
      : {}),
  });
  const text = response.output_text?.trim();
  if (!text) throw new Error("OpenAI returned an empty response");
  return { text, urls: citationUrls(response) };
}

function citationUrls(response: OpenAI.Responses.Response): string[] {
  const urls = new Set<string>();
  for (const item of response.output) {
    if (item.type === "web_search_call") {
      const action = item.action as {
        url?: string | null;
        sources?: Array<{ url?: string }>;
      };
      if (action?.url) urls.add(action.url);
      for (const source of action?.sources || []) {
        if (source.url) urls.add(source.url);
      }
      const results = (item as { results?: Array<{ url?: string }> }).results;
      for (const result of results || []) {
        if (result.url) urls.add(result.url);
      }
    }
    if (item.type !== "message") continue;
    for (const part of item.content) {
      if (part.type !== "output_text") continue;
      for (const annotation of part.annotations || []) {
        if (annotation.type === "url_citation" && annotation.url) {
          urls.add(annotation.url);
        }
      }
    }
  }
  return [...urls];
}
