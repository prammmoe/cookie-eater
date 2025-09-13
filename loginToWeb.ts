import { Browser, Page } from "puppeteer-core";
import "dotenv/config";
import { selectors } from "./selectors";
import { withPage, getBrowser, hasBrowser } from "./puppeteerManager";

export const loginToWeb = async (): Promise<any[]> => {
  const EMAIL = process.env.EMAIL ?? "";
  const PASSWORD = process.env.PASSWORD ?? "";
  const TARGET_URL = process.env.WEB_URL ?? "";

  if (!EMAIL || !PASSWORD) {
    throw new Error("❌ EMAIL or PASSWORD not set in environment variables");
  }
  if (!TARGET_URL) {
    throw new Error("❌ WEB_URL not set in environment variables");
  }

  console.log(`🚀 Navigating to ${TARGET_URL}...`);

  const existedBefore = hasBrowser();
  const browser = await getBrowser();
  if (existedBefore) {
    console.log("♻️ Reusing existing shared browser instance");
  } else {
    console.log("🆕 Launched new shared browser instance for this request");
  }

  return await withPage<any[]>(async (page) => {
    await page.goto(TARGET_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    console.log("✅ Page loaded.");

    // Wait for SPA initialization
    await sleep(2000);

    // Check if already logged in
    const loginBtn = await page
      .waitForSelector(selectors.loginButton, { visible: true, timeout: 10000 })
      .catch(() => null);

    if (!loginBtn) {
      console.log("✅ Already logged in — collecting cookies...");
      await waitForFullAuthentication(page);
      const savedCookies = await getFormattedCookies(
        browser,
        new URL(TARGET_URL).hostname
      );
      await verifyCookies(page, savedCookies, TARGET_URL);
      return savedCookies;
    }

    console.log("🔓 Not logged in, clicking login...");
    await loginBtn.click();

    // Wait for login form
    await sleep(1000);

    // Handle email step
    await page.waitForSelector(selectors.emailInput, {
      visible: true,
      timeout: 15000,
    });
    console.log("⌨️ Typing email...");

    await page.click(selectors.emailInput, { clickCount: 3 });
    await page.keyboard.press("Backspace");
    await page.type(selectors.emailInput, EMAIL, { delay: 50 });

    // Find submit button
    const possibleSubmitSelectors = [
      selectors.submitButton,
      'button[type="submit"]',
      'button:contains("Continue")',
      'button:contains("Next")',
      'input[type="submit"]',
      '[data-testid="continue-button"]',
      '[data-testid="submit-button"]',
    ];

    const submitSelector = await findVisibleSelector(
      page,
      possibleSubmitSelectors
    );
    if (!submitSelector) {
      throw new Error("Submit button not found");
    }

    console.log("🖱️ Clicking Continue (after email)...");
    await Promise.all([
      page.click(submitSelector),
      Promise.race([
        page
          .waitForNavigation({ waitUntil: "networkidle0", timeout: 15000 })
          .catch(() => null),
        sleep(2000), // fallback for SPA
      ]),
    ]);

    // Handle password step
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
    await page.type(foundPasswordSelector, PASSWORD, { delay: 50 });

    await sleep(500);

    const finalSubmitSelector = await findVisibleSelector(
      page,
      possibleSubmitSelectors
    );
    if (!finalSubmitSelector) {
      throw new Error("Final submit button not found");
    }

    console.log("🖱️ Clicking Continue (after password)...");

    // Handle post-login flows
    await Promise.race([
      (async () => {
        await Promise.all([
          page.waitForNavigation({ waitUntil: "networkidle0", timeout: 30000 }),
          page.click(finalSubmitSelector),
        ]);
      })(),
      (async () => {
        await page.click(finalSubmitSelector);
        await Promise.race([
          page.waitForSelector(selectors.loginButton, {
            hidden: true,
            timeout: 20000,
          }),
          page
            .waitForSelector(
              '[data-testid="user-menu"], [data-testid="dashboard"], .user-avatar, .logout-button',
              { visible: true, timeout: 20000 }
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

    const hostname = new URL(TARGET_URL).hostname;
    const savedCookies = await getFormattedCookies(browser, hostname);

    await verifyCookies(page, savedCookies, TARGET_URL);

    return savedCookies;
  });
};

/**
 * Utility to find the first visible selector
 */
const findVisibleSelector = async (
  page: Page,
  selectors: string[]
): Promise<string | null> => {
  for (const sel of selectors) {
    const handle = await page
      .waitForSelector(sel, { visible: true, timeout: 5000 })
      .catch(() => null);
    if (handle) return sel;
  }
  return null;
};

const waitForFullAuthentication = async (page: Page): Promise<void> => {
  console.log("⏳ Waiting for authentication to complete...");
  await sleep(3000);

  const authIndicators = [
    '[data-testid="user-menu"]',
    '[data-testid="dashboard"]',
    ".user-avatar",
    ".logout-button",
    '[data-testid="user-profile"]',
    ".user-name",
    'nav[data-authenticated="true"]',
    ".authenticated",
  ];

  for (const indicator of authIndicators) {
    const element = await page
      .waitForSelector(indicator, { visible: true, timeout: 5000 })
      .catch(() => null);
    if (element) {
      console.log(`✅ Found auth indicator: ${indicator}`);
      break;
    }
  }

  await sleep(2000);

  await page.waitForNetworkIdle({ timeout: 10000 }).catch(() => {
    console.log("⏳ Network idle wait not available or timed out");
  });
};

const getFormattedCookies = async (
  browser: Browser,
  filterHost?: string
): Promise<any[]> => {
  console.log("🍪 Collecting cookies from all browser contexts...");

  let allCookies: any[] = [];
  const defaultCookies = await browser.defaultBrowserContext().cookies();
  allCookies = allCookies.concat(defaultCookies);

  const pages = await browser.pages();
  for (const page of pages) {
    try {
      const pageCookies = await page.cookies();
      allCookies = allCookies.concat(pageCookies);
    } catch (e) {
      console.warn("Could not get cookies from page:", e);
    }
  }

  const uniqueCookies = allCookies.filter(
    (cookie, index, self) =>
      index ===
      self.findIndex(
        (c) =>
          c.name === cookie.name &&
          c.domain === cookie.domain &&
          c.path === cookie.path
      )
  );

  const mapSameSite = (val: any): "strict" | "lax" | "none" | undefined => {
    if (!val) return undefined;
    const v = String(val).toLowerCase();
    if (v.includes("strict")) return "strict";
    if (v.includes("lax")) return "lax";
    if (v.includes("none")) return "none";
    return undefined;
  };

  const byDomain = (cookieDomain: string, host: string) => {
    if (!host) return true;
    if (cookieDomain === host) return true;
    if (cookieDomain === `.${host}`) return true;
    if (cookieDomain.endsWith(`.${host}`)) return true;
    if (host.includes(cookieDomain.replace(/^\./, ""))) return true;
    if (cookieDomain.replace(/^\./, "").includes(host)) return true;
    return false;
  };

  const filtered = filterHost
    ? uniqueCookies.filter((c) => byDomain(c.domain, filterHost))
    : uniqueCookies;

  console.log(
    `🍪 Found ${filtered.length} relevant cookies (${uniqueCookies.length} total unique)`
  );

  return filtered.map((cookie) => {
    const expires =
      typeof cookie.expires === "number" ? cookie.expires : undefined;
    const isSession = !expires || expires <= 0;

    const base: any = {
      domain: cookie.domain,
      hostOnly: !cookie.domain.startsWith("."),
      httpOnly: cookie.httpOnly,
      name: cookie.name,
      path: cookie.path,
      sameSite: mapSameSite((cookie as any).sameSite),
      secure: cookie.secure,
      session: isSession,
      storeId: null,
      value: cookie.value,
      url: `https://${cookie.domain.replace(/^\./, "")}${cookie.path}`,
      priority: (cookie as any).priority || "medium",
    };

    if (!isSession && expires) {
      base.expirationDate = expires;
    }

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
    await sleep(3000);

    const loginButton = await testPage
      .$(selectors.loginButton)
      .catch(() => null);
    const isLoggedIn = !loginButton;

    if (isLoggedIn) {
      console.log(
        "✅ Cookie verification successful - appears to be logged in"
      );
    } else {
      console.log("⚠️ Cookie verification failed - login button still present");

      const authIndicators = [
        '[data-testid="user-menu"]',
        ".user-avatar",
        ".logout-button",
        '[data-testid="dashboard"]',
      ];

      for (const indicator of authIndicators) {
        const element = await testPage.$(indicator).catch(() => null);
        if (element) {
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

export const applyCookiesToPage = async (
  page: Page,
  cookies: any[]
): Promise<void> => {
  console.log("🍪 Applying cookies to new page...");
  for (const cookie of cookies) {
    try {
      await page.setCookie({
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
      console.warn(`Failed to apply cookie ${cookie.name}:`, e?.message ?? e);
    }
  }
  console.log(`✅ Applied ${cookies.length} cookies to page`);
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
