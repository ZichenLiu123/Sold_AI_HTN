import type { Listing } from "../types";

const FILE_PICKER =
  /upload( from computer)?|from computer|browse( files)?|choose file|add photos?|select photos?|select files|take photo|camera|drop photos/i;

function isFilePickerLabel(label: string) {
  return FILE_PICKER.test(label);
}

export type OperatorAction =
  | { action: "click"; target: string }
  | { action: "type"; target: string; text: string }
  | { action: "press"; key: string }
  | { action: "open_editor" }
  | { action: "wait" }
  | { action: "done" }
  | { action: "fail"; reason: string }
  | { action: "rejected"; reason: string };

export type FormKind = "public" | "editor" | "wizard" | "account" | "other";

export type FormSight = {
  url: string;
  kind: FormKind;
  empty: string[];
  errors: string[];
  choices: string[];
  body: string;
};

export type OperatorGoal = {
  mode?: "create" | "revise" | "takedown";
  note?: string;
  editorUrl?: string;
  homeUrl?: string;
};

const FORBIDDEN =
  /^(shipping|marketplace|inbox|home|watchlist|you|menu|search|create|chats|see all|filters|help|share|message( seller)?|save listing|watch|follow|report|privacy|terms|about|sell$)$/i;

export function classifyFormPage(url: string, body: string): FormKind {
  if (/accounts\.craigslist\.org/i.test(url)) {
    if (/\/login\/?(\?|$)/i.test(url) && !/login\/home/i.test(url)) return "other";
    return "account";
  }
  if (/\/login|\/signin|checkpoint/i.test(url)) return "other";
  if (/craigslist\.org\/.+\/d\/.+\/\d+\.html/i.test(url)) return "public";
  if (/post\.craigslist\.org|craigslist\.org\/manage/i.test(url)) return "editor";
  if (/facebook\.com\/marketplace\/item\//i.test(url) && !/edit|composer/i.test(url + body)) {
    return /edit listing|your listing/i.test(body) ? "editor" : "public";
  }
  if (/facebook\.com\/marketplace\/create|marketplace\/edit/i.test(url)) return "editor";
  if (/ebay\.com\/itm\//i.test(url)) return "public";
  if (/ebay\.com\/lstng|ebay\.com\/sl\//i.test(url)) return "editor";
  if (/for sale by owner|posting title|item specifics|list it/i.test(body)) return "wizard";
  return "other";
}

export function parseOperatorAction(text: string): OperatorAction {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { action: "rejected", reason: "Operator returned no JSON action." };
  try {
    const parsed = JSON.parse(match[0]) as OperatorAction;
    if (!parsed?.action) return { action: "rejected", reason: "Operator returned an empty action." };
    return parsed;
  } catch {
    return { action: "rejected", reason: "Operator returned invalid JSON." };
  }
}

export function forbiddenTarget(target: string) {
  const clean = target.replace(/\s+/g, " ").trim();
  return isFilePickerLabel(clean) || FORBIDDEN.test(clean) || /remove photos? with errors/i.test(clean);
}

export function listingAlreadyTakenDown(text: string) {
  return /no longer available|sorry[,']? it'?s not available|this listing isn'?t available|this posting has been deleted|has been deleted by its author|listing (was )?deleted|this listing was deleted/i.test(
    text
  );
}

export function blockedOperatorTarget(target: string, goal?: OperatorGoal) {
  if (goal?.mode !== "takedown") return forbiddenTarget(target);
  const clean = target.replace(/\s+/g, " ").trim();
  return (
    isFilePickerLabel(clean) ||
    listingAlreadyTakenDown(clean) ||
    /\s·\s/.test(clean) ||
    /more options|view similar items|search your listings|message|inbox|chats/i.test(clean) ||
    /^(shipping|inbox|search|create|chats|help|share|message( seller)?|privacy|terms|about)$/i.test(
      clean
    )
  );
}

export function requestedPrice(note: string | undefined, listing: Pick<Listing, "price">) {
  const fromNote = note?.match(/\$?\s*(\d+(?:\.\d+)?)/)?.[1];
  const value = fromNote ? Number(fromNote) : listing.price;
  return value > 0 ? String(Math.round(value)) : "";
}

export function typeValueFor(
  target: string,
  listing: Pick<Listing, "title" | "price" | "description" | "attributes" | "hints">,
  goal?: OperatorGoal
) {
  if (/price|amount/i.test(target)) return requestedPrice(goal?.note, listing);
  if (/title|posting title/i.test(target)) return listing.title;
  if (/description|posting body|body/i.test(target)) return listing.description.slice(0, 500);
  if (/brand/i.test(target)) return listing.attributes?.brand || "Unbranded";
  if (/zip|postal/i.test(target)) return "";
  if (/city|area|neighborhood|location|pickup/i.test(target)) {
    return listing.hints?.pickup_notes || "";
  }
  return "";
}

export function labelAction(decision: OperatorAction) {
  if (decision.action === "type") return `type:${decision.target}`;
  if (decision.action === "click") return `click:${decision.target}`;
  return decision.action;
}

export function describeStuck(history: string[], sight: FormSight, lastOutcome: string) {
  const lines: string[] = [];
  if (lastOutcome) lines.push(`Last outcome: ${lastOutcome}`);
  const recent = history.filter((item) => !item.startsWith("outcome:")).slice(-3);
  if (recent.length >= 2 && recent.every((item) => item === recent[0])) {
    lines.push(`Stuck: you repeated ${recent[0]}. Pick a different action.`);
  }
  if (history.filter((item) => item.startsWith("miss:")).length >= 2) {
    lines.push("Clicks are missing the page. Use a visible label, or open_editor.");
  }
  if ((sight.kind === "public" || sight.kind === "account") && history.length > 0) {
    lines.push(
      `Wrong page: this is a ${sight.kind} page, not the edit form. Click Edit if you see it, or open_editor.`
    );
  }
  return lines.join("\n");
}

export function stillOnWrongPage(sight: FormSight) {
  return sight.kind === "public" || sight.kind === "account";
}

export function shouldOpenEditorAfterStuck(history: string[], sight: FormSight) {
  if (!stillOnWrongPage(sight)) return false;
  if (history.includes("open_editor")) return false;
  const warnings = history.filter((item) => item === "stuck-wrong-page").length;
  return warnings >= 2;
}

export function refineAction(
  decision: OperatorAction,
  sight: FormSight,
  listing: Pick<Listing, "title" | "price" | "description" | "attributes" | "hints">,
  goal: OperatorGoal | undefined,
  history: string[]
): OperatorAction {
  if (goal?.mode === "takedown" && listingAlreadyTakenDown(sight.body)) {
    return { action: "done" };
  }
  if (decision.action === "click" || decision.action === "type") {
    if (blockedOperatorTarget(decision.target, goal)) {
      return {
        action: "rejected",
        reason: `“${decision.target}” is nav / a file picker. Pick a form field or save control.`,
      };
    }
  }
  if (decision.action === "type") {
    const coerced = typeValueFor(decision.target, listing, goal);
    if (coerced) return { ...decision, text: coerced };
  }
  if (decision.action === "done" && stillOnWrongPage(sight) && goal?.mode !== "takedown") {
    return {
      action: "rejected",
      reason: "Cannot finish on a public or account page. Click Edit or open_editor.",
    };
  }
  if (decision.action === "fail" && stillOnWrongPage(sight) && history.filter((item) => item === "fail").length < 2) {
    return {
      action: "rejected",
      reason: `${decision.reason} You are on the wrong page — try Edit or open_editor before failing.`,
    };
  }
  const labeled = labelAction(decision);
  const repeats = history.filter((item) => item === labeled).length;
  if (
    repeats >= 2 &&
    (decision.action === "click" || decision.action === "type") &&
    !/publish|list it|^list$|^done$|continue|save|edit|delete|end listing|remove/i.test(
      decision.action === "click" || decision.action === "type" ? decision.target : ""
    )
  ) {
    return {
      action: "rejected",
      reason: `Already tried ${labeled} twice and it did not help. Do something else.`,
    };
  }
  return decision;
}

export const OPERATOR_SYSTEM = `You are the marketplace operator. You decide every next step. Look at the screenshot, page kind, empty fields, errors, visible controls, and Last outcome.

Return ONE JSON object only. No markdown.

You must recover when you are wrong:
- If the page is public or an account list, you are on the wrong page. Click Edit / edit this posting / edit listing, or return {"action":"open_editor"}.
- If Last outcome says stuck, missed, rejected, or wrong page, do not repeat the same click. Try another visible control or open_editor.
- If a field you typed is still empty or an error remains, try that field again with a different label, or save if the value is already there.

Decide like a careful seller:
- One required next thing. Prefer an empty required field over a header or nav control.
- Click a visible control using its label exactly.
- Never click file pickers, camera, browse, upload from computer, Shipping (the section header), Marketplace, Inbox, Share, Message, or ads.
- Never repeat a control from Already did unless it is Publish, Continue, Save, List it, or Edit.
- When editing a live listing, change only the fields in the seller note, then save.
- When taking a listing down, click Delete / Delete listing / Delete this posting / End listing / Remove listing, confirm if asked, and do not create a new post or mark it sold unless delete is missing.
- If the page already says the listing is no longer available, deleted, or not available, return {"action":"done"} immediately. Do not open chats, More options, or buyer threads.
- Never type on Facebook Marketplace.
- Type the exact title/price/description from the listing facts. Do not invent values.
- done only after the edit is saved, the listing is published, or the listing has been deleted.
- fail only for a login wall or captcha after you have already tried open_editor.

JSON: {"action":"click","target":"continue"} {"action":"type","target":"Price","text":"50"} {"action":"press","key":"Enter"} {"action":"open_editor"} {"action":"wait"} {"action":"done"} {"action":"fail","reason":"..."}`;
