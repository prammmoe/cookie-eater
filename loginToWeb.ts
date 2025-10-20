// loginToWeb.ts
import { Browser, Page } from "puppeteer-core";
import "dotenv/config";
import { selectors } from "./selectors";
import { withPage, getBrowser, hasBrowser } from "./puppeteerManager";

export const loginToWeb = async (): Promise<any[]> => {
  const EMAIL = process.env.EMAIL ?? "";
  const PASSWORD = process.env.PASSWORD ?? "";
  const TARGET_URL = process.env.WEB_URL ?? "";

  if (!EMAIL || !PASSWORD)
    throw new Error("❌ EMAIL or PASSWORD not set in environment variables");
  if (!TARGET_URL)
    throw new Error("❌ WEB_URL not set in environment variables");

  console.log(`🚀 Navigating to ${TARGET_URL}...`);

  const existedBefore = hasBrowser();
  const browser = await getBrowser();
  console.log(
    existedBefore
      ? "♻️ Reusing existing shared browser instance"
      : "🆕 Launched new shared browser instance for this request"
  );

  return await withPage<any[]>(async (page) => {
    await page.goto(TARGET_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    console.log("✅ Page loaded.");

    // SPA warm-up
    await sleep(1500);

    // Already logged in?
    const loginBtn = await page
      .waitForSelector(selectors.loginButton, {
        visible: true,
        timeout: 10_000,
      })
      .catch(() => null);

    if (!loginBtn) {
      console.log("✅ Already logged in — collecting cookies...");
      await waitForFullAuthentication(page);
      await sleep(1500); // beri waktu flush Set-Cookie
      const savedCookies = await getFormattedCookies(
        browser,
        new URL(TARGET_URL).hostname,
        page
      );
      await verifyCookies(page, savedCookies, TARGET_URL);
      return savedCookies;
    }

    console.log("🔓 Not logged in, clicking login...");
    await loginBtn.click();
    await sleep(700);

    // email
    await page.waitForSelector(selectors.emailInput, {
      visible: true,
      timeout: 15_000,
    });
    console.log("⌨️ Typing email...");
    await page.click(selectors.emailInput, { clickCount: 3 });
    await page.keyboard.press("Backspace");
    await page.type(selectors.emailInput, EMAIL, { delay: 40 });

    const possibleSubmitSelectors = [
      selectors.submitButton,
      'button[type="submit"]',
      'button:has-text("Continue")',
      'button:has-text("Next")',
      'input[type="submit"]',
      '[data-testid="continue-button"]',
      '[data-testid="submit-button"]',
    ];
    const submitSelector = await findVisibleSelector(
      page,
      possibleSubmitSelectors
    );
    if (!submitSelector) throw new Error("Submit button not found");

    console.log("🖱️ Clicking Continue (after email)...");
    await Promise.all([
      page.click(submitSelector),
      Promise.race([
        page
          .waitForNavigation({ waitUntil: "networkidle0", timeout: 15_000 })
          .catch(() => null),
        sleep(1500),
      ]),
    ]);

    // password
    console.log("⏳ Waiting for password field...");
    const possiblePasswordSelectors = [
      selectors.passwordInput,
      'input[type="password"]',
      'input[name="password"]',
      'input[autocomplete*="password"]',
      '[data-testid="password-input"]',
      "#password",
      ".password-input",
    ];
    const foundPasswordSelector = await findVisibleSelector(
      page,
      possiblePasswordSelectors
    );
    if (!foundPasswordSelector) {
      await page.screenshot({
        path: "password-field-not-found.png",
        fullPage: true,
      });
      throw new Error("Password input did not appear in time");
    }

    console.log("🔒 Typing password...");
    await page.click(foundPasswordSelector, { clickCount: 3 });
    await page.keyboard.press("Backspace");
    await page.type(foundPasswordSelector, PASSWORD, { delay: 40 });

    const finalSubmitSelector = await findVisibleSelector(
      page,
      possibleSubmitSelectors
    );
    if (!finalSubmitSelector) throw new Error("Final submit button not found");

    console.log("🖱️ Clicking Continue (after password)...");
    await Promise.race([
      (async () => {
        await Promise.all([
          page.waitForNavigation({
            waitUntil: "networkidle0",
            timeout: 30_000,
          }),
          page.click(finalSubmitSelector),
        ]);
      })(),
      (async () => {
        await page.click(finalSubmitSelector);
        await Promise.race([
          page.waitForSelector(selectors.loginButton, {
            hidden: true,
            timeout: 20_000,
          }),
          page
            .waitForSelector(
              '[data-testid="user-menu"], [data-testid="dashboard"], .user-avatar, .logout-button',
              { visible: true, timeout: 20_000 }
            )
            .catch(() => null),
        ]);
      })(),
    ]);

    console.log("⏳ Waiting for full authentication...");
    await waitForFullAuthentication(page);

    const stillHasLogin = await page.$(selectors.loginButton);
    if (stillHasLogin) {
      await page.screenshot({ path: "login-failed.png", fullPage: true });
      console.warn(
        "⚠️ Login button still present after submit — login may have failed."
      );
    } else {
      console.log("✅ Login successful, collecting cookies...");
    }

    // beri waktu flush Set-Cookie
    await sleep(1500);

    const hostname = new URL(TARGET_URL).hostname;
    const savedCookies = await getFormattedCookies(browser, hostname, page);

    await verifyCookies(page, savedCookies, TARGET_URL);
    return savedCookies;
  });
};

// --- utils ---
const findVisibleSelector = async (
  page: Page,
  selectors: string[]
): Promise<string | null> => {
  for (const sel of selectors) {
    const handle = await page
      .waitForSelector(sel, { visible: true, timeout: 5_000 })
      .catch(() => null);
    if (handle) return sel;
  }
  return null;
};

const waitForFullAuthentication = async (page: Page): Promise<void> => {
  console.log("⏳ Waiting for authentication to complete...");
  await sleep(1200);
  const indicators = [
    '[data-testid="user-menu"]',
    '[data-testid="dashboard"]',
    ".user-avatar",
    ".logout-button",
    '[data-testid="user-profile"]',
    ".user-name",
    'nav[data-authenticated="true"]',
    ".authenticated",
  ];
  for (const indicator of indicators) {
    const element = await page
      .waitForSelector(indicator, { visible: true, timeout: 5_000 })
      .catch(() => null);
    if (element) {
      console.log(`✅ Found auth indicator: ${indicator}`);
      break;
    }
  }
  await page.waitForNetworkIdle({ timeout: 10_000 }).catch(() => {
    console.log("⏳ Network idle wait not available or timed out");
  });
};

// === COOKIE HARVEST (serverless-safe) ===
const getFormattedCookies = async (
  browser: Browser,
  filterHost?: string,
  currentPage?: Page
): Promise<any[]> => {
  console.log("🍪 Collecting cookies from all browser contexts...");

  const domains = new Set<string>();
  const all: any[] = [];

  // 1) Semua BrowserContext
  const contexts = browser.browserContexts();
  console.log("🍪 Debug: contexts =", contexts.length);
  for (const ctx of contexts) {
    try {
      const ctxCookies = await ctx.cookies();
      all.push(...ctxCookies);
      ctxCookies.forEach((c) => domains.add(c.domain));
    } catch (e) {
      console.warn("⚠️ Failed to read ctx cookies:", e);
    }
  }

  // 2) Semua Page (kadang lebih sukses dari ctx.cookies())
  const pages = await browser.pages();
  console.log("🍪 Debug: pages =", pages.length);
  for (const p of pages) {
    try {
      const pc = await p.cookies();
      all.push(...pc);
      pc.forEach((c) => domains.add(c.domain));
    } catch (e) {
      console.warn("⚠️ Failed to read page cookies:", e);
    }
  }

  console.log("🍪 Debug: cookie domains seen =", Array.from(domains));

  // 3) Fallback: document.cookie (last resort)
  if (all.length === 0 && currentPage) {
    try {
      const docCookie = await currentPage.evaluate(() => document.cookie);
      console.log("🍪 Fallback document.cookie =", docCookie);
      if (docCookie && docCookie.trim().length) {
        const parsed = docCookie.split(";").map((kv) => {
          const [name, ...rest] = kv.split("=");
          return {
            name: name.trim(),
            value: rest.join("=").trim(),
            domain: "." + new URL(currentPage.url()).hostname,
            path: "/",
            httpOnly: false,
            secure: true,
            session: true,
          };
        });
        all.push(...(parsed as any[]));
      }
    } catch (e) {
      console.warn("⚠️ document.cookie fallback failed:", e);
    }
  }

  // Uniq by (name+domain+path)
  const unique = all.filter(
    (cookie, index, self) =>
      index ===
      self.findIndex(
        (c) =>
          c.name === cookie.name &&
          c.domain === cookie.domain &&
          c.path === cookie.path
      )
  );

  const byDomainLoose = (cookieDomain: string, host: string) => {
    const cd = (cookieDomain || "").replace(/^\./, "");
    const h = (host || "").replace(/^\./, "");
    if (!h) return true;
    return (
      cd === h ||
      cd.endsWith("." + h) ||
      h.endsWith("." + cd) ||
      cd.includes(h) ||
      h.includes(cd)
    );
  };

  const filtered = filterHost
    ? unique.filter((c) => byDomainLoose(c.domain, filterHost))
    : unique;

  console.log(
    `🍪 Found ${filtered.length} relevant cookies (${unique.length} total unique)`
  );

  const mapSameSite = (val: any): "strict" | "lax" | "none" | undefined => {
    if (!val) return undefined;
    const v = String(val).toLowerCase();
    if (v.includes("strict")) return "strict";
    if (v.includes("lax")) return "lax";
    if (v.includes("none")) return "none";
    return undefined;
  };

  return filtered.map((cookie: any) => {
    const expires =
      typeof cookie.expires === "number" ? cookie.expires : undefined;
    const isSession = !expires || expires <= 0;
    const base: any = {
      domain: cookie.domain,
      hostOnly: cookie.domain ? !String(cookie.domain).startsWith(".") : false,
      httpOnly: !!cookie.httpOnly,
      name: cookie.name,
      path: cookie.path ?? "/",
      sameSite: mapSameSite(cookie.sameSite),
      secure: !!cookie.secure,
      session: isSession,
      storeId: null,
      value: cookie.value,
      url: cookie.domain
        ? `https://${String(cookie.domain).replace(/^\./, "")}${
            cookie.path ?? "/"
          }`
        : undefined,
      priority: (cookie as any).priority || "Medium",
    };
    if (!isSession && expires) base.expirationDate = expires;
    return base;
  });
};

const verifyCookies = async (
  testPage: Page,
  cookies: any[],
  targetUrl: string
): Promise<void> => {
  console.log("🧪 Verifying cookies work for authentication...");
  try {
    for (const cookie of cookies) {
      try {
        await testPage.setCookie({
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path,
          httpOnly: cookie.httpOnly,
          secure: cookie.secure,
          sameSite: cookie.sameSite as any,
          expires: cookie.expirationDate,
        });
      } catch (e: any) {
        console.warn(`Failed to set cookie ${cookie.name}:`, e?.message ?? e);
      }
    }

    await testPage.goto(targetUrl, { waitUntil: "domcontentloaded" });
    await sleep(1200);

    const loginButton = await testPage
      .$(selectors.loginButton)
      .catch(() => null);
    const isLoggedIn = !loginButton;

    if (isLoggedIn)
      console.log(
        "✅ Cookie verification successful - appears to be logged in"
      );
    else {
      console.log("⚠️ Cookie verification failed - login button still present");
      const indicators = [
        '[data-testid="user-menu"]',
        ".user-avatar",
        ".logout-button",
        '[data-testid="dashboard"]',
      ];
      for (const indicator of indicators) {
        const el = await testPage.$(indicator).catch(() => null);
        if (el) {
          console.log(
            `✅ Found auth indicator: ${indicator} - cookies might still work`
          );
          break;
        }
      }
    }
  } catch (error) {
    console.error("❌ Cookie verification failed:", error);
  }
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
