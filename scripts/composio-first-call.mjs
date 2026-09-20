import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Composio } from "@composio/core";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const line of readFileSync(resolve(root, ".env.local"), "utf8").split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
  const index = trimmed.indexOf("=");
  const key = trimmed.slice(0, index);
  let value = trimmed.slice(index + 1);
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  if (!process.env[key]) process.env[key] = value;
}

if (!process.env.COMPOSIO_API_KEY) {
  console.error("COMPOSIO_API_KEY missing from environment");
  process.exit(1);
}

const userId = process.env.COMPOSIO_USER_ID || "sold-demo";
const composio = new Composio();

function summarize(result) {
  return {
    successful: result?.successful ?? result?.successful === undefined,
    hasError: Boolean(result?.error),
    error: result?.error ? String(result.error).slice(0, 240) : null,
    logId: result?.logId || result?.log_id || null,
    keys: result && typeof result === "object" ? Object.keys(result) : [],
    dataKeys:
      result?.data && typeof result.data === "object"
        ? Object.keys(result.data)
        : [],
  };
}

const gmailTools = await composio.tools.getRawComposioTools({
  toolkits: ["gmail"],
  search: "get profile",
  limit: 25,
});
const gmailSlugs = (gmailTools || []).map((tool) => tool.slug);
const profileTool = gmailSlugs.find((slug) => slug === "GMAIL_GET_PROFILE") ||
  gmailSlugs.find((slug) => /PROFILE/i.test(slug));

const hnTools = await composio.tools.getRawComposioTools({
  search: "hackernews get user",
  limit: 15,
});
const hnSlugs = (hnTools || []).map((tool) => tool.slug);
const hnTool = hnSlugs.find((slug) => slug === "HACKERNEWS_GET_USER") ||
  hnSlugs.find((slug) => /HACKERNEWS.*USER/i.test(slug));

const accounts = await composio.connectedAccounts.list({
  userIds: [userId],
  toolkitSlugs: ["gmail"],
});
const gmailAccounts = (accounts?.items || []).map((item) => ({
  id: item.id,
  status: item.status,
  toolkit: item.toolkit?.slug || item.toolkit?.name,
}));
const activeGmail = gmailAccounts.find((item) => item.status === "ACTIVE");

console.log(
  JSON.stringify(
    {
      userId,
      discoveredGmailTools: gmailSlugs.slice(0, 12),
      profileTool: profileTool || null,
      discoveredHnTools: hnSlugs.slice(0, 8),
      hnTool: hnTool || null,
      gmailAccounts,
      activeGmail: Boolean(activeGmail),
    },
    null,
    2
  )
);

let hnResult = null;
if (hnTool) {
  hnResult = await composio.tools.execute(hnTool, {
    userId,
    arguments: { username: "pg" },
    dangerouslySkipVersionCheck: true,
  });
  console.log("HN_CALL", JSON.stringify(summarize(hnResult)));
}

if (activeGmail && profileTool) {
  const profile = await composio.tools.execute(profileTool, {
    userId,
    arguments: { user_id: "me" },
    dangerouslySkipVersionCheck: true,
  });
  const email =
    profile?.data?.emailAddress ||
    profile?.data?.email ||
    profile?.data?.email_address ||
    null;
  console.log(
    "GMAIL_PROFILE",
    JSON.stringify({
      ...summarize(profile),
      hasEmail: Boolean(email),
    })
  );
  process.exit(0);
}

const listed = await composio.authConfigs.list({ toolkit: "gmail" });
const authConfigId =
  (listed?.items || []).find((item) => item.isComposioManaged)?.id ||
  listed?.items?.[0]?.id;
if (!authConfigId) {
  console.error("No Gmail auth config found");
  process.exit(1);
}
const connectionRequest = await composio.connectedAccounts.link(
  userId,
  authConfigId
);
console.log(
  JSON.stringify(
    {
      connectId: connectionRequest.id,
      connectStatus: connectionRequest.status,
      redirectUrl: connectionRequest.redirectUrl,
    },
    null,
    2
  )
);
