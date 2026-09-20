import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./storage";

function watchFile() {
  return path.join(dataDir(), "inbox-watch.json");
}

export function inboxWatchEnabled() {
  try {
    const raw = JSON.parse(fs.readFileSync(watchFile(), "utf8")) as {
      enabled?: boolean;
    };
    return raw.enabled !== false;
  } catch {
    return true;
  }
}

export function setInboxWatchEnabled(enabled: boolean) {
  fs.writeFileSync(watchFile(), JSON.stringify({ enabled }));
  return enabled;
}
