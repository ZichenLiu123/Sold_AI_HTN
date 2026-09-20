import type { Page } from "playwright-core";
import { complete } from "../llm";
import { getSellerProfile, logAgent } from "../db";
import { sellerPlace } from "../profile";
import type { Listing, Platform } from "../types";
import { armPhotoChooser, attachListingPhotos, isFilePickerLabel } from "../marketplace/photos";
import { clickByText } from "../marketplace/adapters";
import {
  OPERATOR_SYSTEM,
  classifyFormPage,
  describeStuck,
  blockedOperatorTarget,
  labelAction,
  listingAlreadyTakenDown,
  parseOperatorAction,
  refineAction,
  shouldOpenEditorAfterStuck,
  stillOnWrongPage,
  type FormSight,
  type OperatorAction,
  type OperatorGoal,
} from "./operator-decide";

import { throwIfCancelled } from "./cancel";

async function visibleChoices(page: Page) {
  const names: string[] = [];
  for (const role of ["button", "link", "combobox", "option", "menuitem", "textbox", "radio", "checkbox"] as const) {
    const labels = await page.getByRole(role).allTextContents().catch(() => []);
    for (const label of labels) {
      const clean = label.replace(/\s+/g, " ").trim();
      if (clean && clean.length < 80) names.push(`${role}:${clean}`);
    }
  }
  return [...new Set(names)].slice(0, 80);
}

async function sightPage(page: Page): Promise<FormSight> {
  const url = page.url();
  const body = (await page.locator("body").innerText().catch(() => "")).slice(0, 4000);
  const empty = await page
    .evaluate(() =>
      [...document.querySelectorAll("input, textarea, select")]
        .filter((node) => {
          const el = node as HTMLInputElement;
          if (el.type === "hidden" || el.type === "file" || el.offsetParent === null) return false;
          return !String(el.value || "").trim();
        })
        .map((node) => {
          const el = node as HTMLInputElement;
          return (
            el.getAttribute("aria-label") ||
            el.placeholder ||
            el.name ||
            (el.labels?.[0]?.innerText || "")
          )
            .replace(/\s+/g, " ")
            .trim();
        })
        .filter((label) => label && label.length < 60)
    )
    .catch(() => [] as string[]);
  const errors = body
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) =>
      /required|missing|enter a|please (add|enter|select)|additional details/i.test(line)
    )
    .slice(0, 8);
  return {
    url,
    kind: classifyFormPage(url, body),
    empty: [...new Set(empty)].slice(0, 20),
    errors,
    choices: await visibleChoices(page),
    body,
  };
}

async function clickTarget(page: Page, target: string) {
  const exact = new RegExp(`^${target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
  const fuzzy = new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  for (const role of ["button", "option", "menuitem", "combobox", "link", "textbox", "radio", "checkbox"] as const) {
    const control = page.getByRole(role, { name: exact }).first();
    if (await control.isVisible().catch(() => false)) {
      await control.click({ timeout: 8_000 });
      return true;
    }
  }
  for (const role of ["button", "option", "menuitem", "combobox", "link", "radio", "checkbox"] as const) {
    const control = page.getByRole(role, { name: fuzzy }).first();
    if (await control.isVisible().catch(() => false)) {
      await control.click({ timeout: 8_000 });
      return true;
    }
  }
  const labeled = page.getByText(exact).last();
  if (await labeled.isVisible().catch(() => false)) {
    await labeled.click({ timeout: 8_000 });
    return true;
  }
  return false;
}

async function typeTarget(page: Page, target: string, text: string) {
  const name = new RegExp(target, "i");
  for (const role of ["textbox", "searchbox", "combobox", "spinbutton"] as const) {
    const box = page.getByRole(role, { name }).first();
    if (await box.isVisible().catch(() => false)) {
      await box.click();
      const editable = await box
        .evaluate((el) => {
          const tag = el.tagName.toLowerCase();
          return (
            tag === "input" ||
            tag === "textarea" ||
            el.getAttribute("contenteditable") === "true"
          );
        })
        .catch(() => false);
      if (editable) await box.fill(text);
      else await page.keyboard.type(text, { delay: 15 });
      return true;
    }
  }
  const named = page.locator(`input[name="${target}" i], input[name="price"]`).first();
  if (/price/i.test(target) && (await named.isVisible().catch(() => false))) {
    await named.fill(text);
    return true;
  }
  if (await clickTarget(page, target)) {
    await page.keyboard.type(text, { delay: 15 });
    return true;
  }
  return false;
}

function operatorFacts(
  listing: Listing,
  platform: Platform,
  place: { location: string; zip: string },
  goal?: OperatorGoal
) {
  const location = listing.hints?.pickup_notes?.trim() || place.location;
  return [
    `Mode: ${goal?.mode || "create"}`,
    goal?.note ? `Seller edit: ${goal.note}` : "",
    `Title: ${listing.title}`,
    `Price: ${listing.price}`,
    `Description: ${listing.description.slice(0, 280)}`,
    `Category: ${listing.attributes?.category || "unknown"}`,
    `Condition: ${listing.attributes?.condition || "used"}`,
    `Brand: ${listing.attributes?.brand || "Unbranded"}`,
    `Model: ${listing.attributes?.model || ""}`,
    location ? `Location: ${location}` : "Do not invent a location.",
    place.zip ? `ZIP: ${place.zip}` : "",
    goal?.mode === "takedown"
      ? "Find this seller’s live listing and delete or end it. Confirm if asked. If the page already says it is no longer available or deleted, you are done. Do not open buyer chats and do not type on Facebook."
      : platform === "eBay"
        ? "Photos attach automatically. Never open a file picker. Required: photos, Brand, then List it."
        : "Photos attach automatically. Never open a file picker.",
    goal?.editorUrl ? `Editor URL available via open_editor.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function operateListingForm(
  page: Page,
  listing: Listing,
  platform: Platform,
  goal?: OperatorGoal
): Promise<{ published: boolean; detail: string }> {
  const history: string[] = [];
  const profile = await getSellerProfile();
  const place = { location: sellerPlace(profile), zip: profile.zip.trim() };
  const revise = goal?.mode === "revise" || goal?.mode === "takedown";
  const limit = revise ? 16 : platform === "eBay" ? 28 : platform === "Craigslist" ? 18 : 14;
  const disarmPhotos = armPhotoChooser(page, listing);
  let lastOutcome = "";
  try {
    for (let step = 0; step < limit; step += 1) {
      throwIfCancelled(listing.id);
      const url = page.url();
      if (
        !revise &&
        (/marketplace\/item\/\d+/i.test(url) ||
          /craigslist\.org\/.+\/d\/.+\/\d+\.html/i.test(url) ||
          /ebay\.com\/itm\/\d+/i.test(url))
      ) {
        return { published: true, detail: `Live listing opened at ${url}` };
      }
      if (
        goal?.mode !== "takedown" &&
        !history.includes("photos") &&
        (await attachListingPhotos(page, listing).catch(() => false))
      ) {
        history.push("photos");
      }

      const sight = await sightPage(page);
      if (goal?.mode === "takedown" && listingAlreadyTakenDown(sight.body)) {
        return { published: true, detail: `Gone from ${platform}. It looks deleted or taken down.` };
      }
      if (stillOnWrongPage(sight) && lastOutcome) {
        history.push("stuck-wrong-page");
      }

      let decision: OperatorAction;
      if (shouldOpenEditorAfterStuck(history, sight) && (goal?.editorUrl || goal?.homeUrl)) {
        decision = { action: "open_editor" };
        lastOutcome = "Operator stayed on the wrong page after two tries. Opening the editor, then asking again.";
        await logAgent(listing.id, "browser", "FORM", lastOutcome);
      } else {
        decision = await askOperator(page, listing, platform, place, goal, sight, history, lastOutcome);
        decision = refineAction(decision, sight, listing, goal, history);
      }

      if (decision.action === "rejected") {
        lastOutcome = decision.reason;
        history.push(`outcome:${decision.reason.slice(0, 80)}`);
        await logAgent(
          listing.id,
          "browser",
          "FORM",
          `Operator tried a bad step. Asking again: ${decision.reason}`
        );
        continue;
      }

      const labeled = labelAction(decision);
      history.push(labeled);
      await logAgent(
        listing.id,
        "browser",
        "FORM",
        `Operator: ${describeOperatorStep(platform, decision, revise)}`
      );

      if (decision.action === "done") {
        return {
          published: Boolean(revise),
          detail:
            goal?.mode === "takedown"
              ? "Operator says the listing is taken down."
              : revise
                ? "Operator says the live edit is saved."
                : "Operator says the form is ready.",
        };
      }
      if (decision.action === "fail") {
        return { published: false, detail: decision.reason };
      }
      if (decision.action === "wait") {
        await page.waitForTimeout(1_000);
        lastOutcome = "Waited. Look at the page again.";
        continue;
      }
      if (decision.action === "press") {
        await page.keyboard.press(decision.key);
        await page.waitForTimeout(400);
        lastOutcome = `Pressed ${decision.key}.`;
        continue;
      }
      if (decision.action === "open_editor") {
        const opened = await openEditorFromGoal(page, platform, goal);
        await page.waitForTimeout(800);
        const after = await sightPage(page);
        lastOutcome = stillOnWrongPage(after)
          ? "open_editor ran but the edit form is still not showing."
          : "Opened the editor. Continue the seller note.";
        if (!opened) lastOutcome = "open_editor had no editor URL. Click a visible Edit link.";
        continue;
      }
      try {
        if (decision.action === "click") {
          if (blockedOperatorTarget(decision.target, goal) || isFilePickerLabel(decision.target)) {
            lastOutcome = `Blocked click on “${decision.target}”.`;
            history.push("skip-bad-click");
            continue;
          }
          const ok = await clickTarget(page, decision.target);
          if (!ok) {
            history.push(`miss:${decision.target}`);
            lastOutcome = `Could not click “${decision.target}”. It may not be on this page.`;
            continue;
          }
          await page.waitForTimeout(500);
          if (/delete|end listing|remove listing|unpublish/i.test(decision.target)) {
            await page.waitForTimeout(800);
            const confirm = await clickTarget(page, "delete").catch(() => false);
            if (!confirm) await clickTarget(page, "yes").catch(() => false);
            await page.waitForTimeout(800);
            const pageBody = await page.locator("body").innerText().catch(() => "");
            if (
              /deleted|removed|ended|no longer|has been deleted|posting has been deleted|listing ended/i.test(
                pageBody
              )
            ) {
              return { published: true, detail: `Operator took the listing down on ${platform}.` };
            }
            lastOutcome = `Clicked “${decision.target}”. Confirm if a dialog is still open.`;
          } else if (/publish|list it|^list$|^done$|continue|save/i.test(decision.target)) {
            await page.waitForTimeout(1_200);
            const after = page.url();
            const pageBody = await page.locator("body").innerText().catch(() => "");
            if (
              /marketplace\/item\/\d+/i.test(after) ||
              /craigslist\.org\/.+\/d\/.+\/\d+\.html/i.test(after) ||
              /ebay\.com\/itm\/\d+/i.test(after) ||
              /thanks for posting|your posting can be seen|changes (were )?saved|listing (was )?updated|you listed this/i.test(
                pageBody
              )
            ) {
              return { published: true, detail: `Operator published at ${after}` };
            }
            lastOutcome = `Clicked “${decision.target}”. Check if the save finished or another step remains.`;
          } else {
            lastOutcome = `Clicked “${decision.target}”.`;
          }
          continue;
        }
        if (decision.action === "type") {
          if (platform === "Facebook Marketplace") {
            lastOutcome = "Did not type on Facebook.";
            continue;
          }
          const ok = await typeTarget(page, decision.target, decision.text);
          lastOutcome = ok
            ? `Typed into ${decision.target}.`
            : `Could not find “${decision.target}” to type into.`;
          if (!ok) history.push(`miss-type:${decision.target}`);
          await page.waitForTimeout(400);
        }
      } catch {
        lastOutcome = "That step threw. Look at the page and try a different control.";
        history.push("step-error");
      }
    }
    return {
      published: false,
      detail:
        goal?.mode === "takedown"
          ? "Operator ran out of steps before the listing was taken down."
          : "Operator ran out of steps before the listing went live.",
    };
  } finally {
    disarmPhotos();
  }
}

function describeOperatorStep(platform: string, decision: OperatorAction, revise: boolean) {
  if (decision.action === "open_editor") return `opening the ${platform} editor after seeing the wrong page.`;
  if (decision.action === "type") {
    return revise && /price/i.test(decision.target)
      ? `type ${decision.target} → ${decision.text}`
      : `type ${decision.target}`;
  }
  if (decision.action === "click") return `click “${decision.target}”`;
  if (decision.action === "fail") return `fail: ${decision.reason}`;
  return decision.action;
}

async function openEditorFromGoal(page: Page, platform: Platform, goal?: OperatorGoal) {
  const editorUrl = goal?.editorUrl;
  const homeUrl = goal?.homeUrl;
  if (editorUrl) {
    await page.goto(editorUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.waitForTimeout(700);
  } else if (homeUrl) {
    await page.goto(homeUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.waitForTimeout(700);
  } else {
    return false;
  }
  const priceReady = await page.locator('input[name="price"]').first().isVisible().catch(() => false);
  if (priceReady) return true;
  await clickByText(page, [
    /edit this posting/i,
    /edit listing/i,
    /revise listing/i,
    /^edit$/i,
    /^revise$/i,
  ]).catch(() => false);
  return true;
}

async function askOperator(
  page: Page,
  listing: Listing,
  platform: Platform,
  place: { location: string; zip: string },
  goal: OperatorGoal | undefined,
  sight: FormSight,
  history: string[],
  lastOutcome: string
): Promise<OperatorAction> {
  const stuck = describeStuck(history, sight, lastOutcome);
  const shot = await page.screenshot({ type: "jpeg", quality: 50, fullPage: false });
  const raw = await complete({
    system: OPERATOR_SYSTEM,
    text: [
      `Platform: ${platform}`,
      `Page kind: ${sight.kind}`,
      `URL: ${sight.url}`,
      operatorFacts(listing, platform, place, goal),
      `Empty fields: ${sight.empty.join(", ") || "none visible"}`,
      `Errors: ${sight.errors.join(" | ") || "none"}`,
      `Visible controls: ${sight.choices.join(" | ") || "(none read)"}`,
      `Already did: ${history.filter((item) => !item.startsWith("outcome:")).join(" → ") || "nothing"}`,
      stuck || "Not stuck.",
    ].join("\n"),
    images: [
      {
        media_type: "image/jpeg",
        data: shot.toString("base64"),
        detail: "low",
      },
    ],
    maxTokens: 250,
  });
  return parseOperatorAction(raw);
}
