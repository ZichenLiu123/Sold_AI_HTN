import type { Page } from "playwright-core";

function escapeRe(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function dismissEbayChromeJunk(page: Page) {
  await page
    .getByRole("button", { name: /^restore$/i })
    .first()
    .click({ timeout: 1_200 })
    .catch(() => undefined);
  await page
    .getByRole("button", { name: /^close$/i })
    .first()
    .click({ timeout: 1_200 })
    .catch(() => undefined);
}

export async function ebayBrandRequired(page: Page) {
  const body = await page.locator("body").innerText().catch(() => "");
  return /additional details are required:\s*brand/i.test(body);
}

export async function ebayBrandIsSet(page: Page, _brand?: string) {
  return !(await ebayBrandRequired(page));
}

async function brandSearchBox(page: Page) {
  const candidates = [
    page.getByPlaceholder(/search or enter your own/i).first(),
    page.getByRole("textbox", { name: /search or enter your own/i }).first(),
    page.locator('input[placeholder*="Search" i]').first(),
    page.locator('input[placeholder*="enter your own" i]').first(),
  ];
  for (const box of candidates) {
    if (await box.isVisible().catch(() => false)) return box;
  }
  return null;
}

async function visibleOptions(page: Page) {
  const texts = await page
    .getByRole("option")
    .allTextContents()
    .catch(() => []);
  return texts.map((text) => text.replace(/\s+/g, " ").trim()).filter(Boolean);
}

async function clickOption(page: Page, name: string) {
  const exact = page.getByRole("option", { name: new RegExp(`^${escapeRe(name)}$`, "i") }).first();
  if (await exact.isVisible().catch(() => false)) {
    await exact.click({ timeout: 3_000 }).catch(() => undefined);
    return true;
  }
  const fuzzy = page.getByText(new RegExp(`^${escapeRe(name)}$`, "i")).last();
  if (await fuzzy.isVisible().catch(() => false)) {
    await fuzzy.click({ timeout: 3_000 }).catch(() => undefined);
    return true;
  }
  return false;
}

async function openBrandMenu(page: Page) {
  if (await brandSearchBox(page)) return true;
  await page
    .getByText(/^brand$/i)
    .first()
    .click({ timeout: 3_000 })
    .catch(() => undefined);
  await page.waitForTimeout(400);
  if (await brandSearchBox(page)) return true;
  await page
    .getByLabel(/^brand$/i)
    .first()
    .click({ timeout: 3_000 })
    .catch(() => undefined);
  await page.waitForTimeout(400);
  if (await brandSearchBox(page)) return true;
  await page
    .locator("label")
    .filter({ hasText: /^brand$/i })
    .locator("xpath=following::input[1] | following::*[@role='combobox'][1]")
    .first()
    .click({ timeout: 3_000 })
    .catch(() => undefined);
  await page.waitForTimeout(400);
  return Boolean(await brandSearchBox(page) || (await visibleOptions(page)).length);
}

export async function fillEbayBrand(page: Page, brand: string) {
  try {
    await dismissEbayChromeJunk(page);
    if (!(await ebayBrandRequired(page))) return true;
    await openBrandMenu(page);

    const search = await brandSearchBox(page);
    if (search) {
      await search.click({ timeout: 2_000 }).catch(() => undefined);
      await search.fill("");
      await search.pressSequentially(brand, { delay: 50 });
      await page.waitForTimeout(900);
      const options = await visibleOptions(page);
      const match = options.find((text) => new RegExp(escapeRe(brand), "i").test(text));
      if (match) {
        await clickOption(page, match);
        await page.waitForTimeout(500);
        if (!(await ebayBrandRequired(page))) return true;
      } else if (options[0]) {
        await clickOption(page, options[0]);
        await page.waitForTimeout(500);
        if (!(await ebayBrandRequired(page))) return true;
      }
      await page.keyboard.press("Enter").catch(() => undefined);
      await page.waitForTimeout(500);
      if (!(await ebayBrandRequired(page))) return true;
    }

    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(200);
    await openBrandMenu(page);
    if (await clickOption(page, "Unbranded")) {
      await page.waitForTimeout(500);
      return !(await ebayBrandRequired(page));
    }
    return false;
  } catch {
    return false;
  }
}

export async function fillEbayCombobox(page: Page, label: string, value: string) {
  if (label === "Brand") return fillEbayBrand(page, value);
  try {
    await dismissEbayChromeJunk(page);
    await page
      .getByText(new RegExp(`^${escapeRe(label)}$`, "i"))
      .first()
      .click({ timeout: 3_000 })
      .catch(() => undefined);
    await page.waitForTimeout(400);
    const search = await brandSearchBox(page);
    if (search) {
      await search.fill("");
      await search.pressSequentially(value, { delay: 40 });
      await page.waitForTimeout(700);
      const options = await visibleOptions(page);
      const match = options.find((text) => new RegExp(escapeRe(value), "i").test(text)) || options[0];
      if (match) await clickOption(page, match);
      else await page.keyboard.press("Enter").catch(() => undefined);
      return true;
    }
    await page.keyboard.type(value, { delay: 30 });
    await page.keyboard.press("Enter").catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}
