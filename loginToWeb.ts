import puppeteer, { Browser, Page } from "puppeteer";
import "dotenv/config";
import { selectors } from "./selectors";

export const loginToWeb = async (): Promise<any[]> => {
  const IS_HEADLESS = process.env.ENVIRONMENT === "PRODUCTION";
  const EMAIL = process.env.EMAIL ?? "";
  const PASSWORD = process.env.PASSWORD ?? "";

  if (!EMAIL || !PASSWORD) {
    throw new Error("❌ EMAIL or PASSWORD not set in environment variables");
  }

  console.log("🚀 Launching browser...");

  const browser = await puppeteer.launch({
    headless: IS_HEADLESS,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-web-security",
      "--disable-features=VizDisplayCompositor",
    ],
  });
  console.log("🚀 Browser launched.");

  const page = await browser.newPage();
  // Make waits faster and more consistent
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(60000);

  // Set user agent to avoid detection
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );

  const TARGET_URL = process.env.WEB_URL ?? "";
  console.log(`🚀 Navigating to ${TARGET_URL}...`);

  try {
    await page.goto(TARGET_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    console.log("✅ Page loaded.");

    // Wait for page to fully load including any SPA initialization
    await sleep(2000);

    // Check for login state via login button presence, but allow SPA delays
    const loginBtn = await page
      .waitForSelector(selectors.loginButton, { visible: true, timeout: 10000 })
      .catch(() => null);

    if (!loginBtn) {
      console.log("✅ Already logged in — collecting cookies...");
      await waitForFullAuthentication(page);
      const savedCookies = await getFormattedCookies(
        browser,
        new globalThis.URL(TARGET_URL).hostname
      );
      await verifyCookies(browser, savedCookies, TARGET_URL);
      return savedCookies;
    }

    console.log("🔓 Not logged in, clicking login...");
    await loginBtn.click();

    // Wait for login form to appear
    await sleep(1000);

    // Email step
    const emailSelector = selectors.emailInput;
    await page.waitForSelector(emailSelector, {
      visible: true,
      timeout: 15000,
    });
    console.log("⌨️ Typing email...");

    // Clear field first
    await page.click(emailSelector, { clickCount: 3 });
    await page.keyboard.press("Backspace");
    await page.type(emailSelector, EMAIL, { delay: 50 });

    // Find a submit button robustly
    const possibleSubmitSelectors = [
      selectors.submitButton,
      'button[type="submit"]',
      'button:contains("Continue")',
      'button:contains("Next")',
      'input[type="submit"]',
      '[data-testid="continue-button"]',
      '[data-testid="submit-button"]',
    ];

    let submitSelector: string | null = null;
    for (const sel of possibleSubmitSelectors) {
      const handle = await page
        .waitForSelector(sel, { visible: true, timeout: 5000 })
        .catch(() => null);
      if (handle) {
        submitSelector = sel;
        break;
      }
    }

    if (!submitSelector) {
      throw new Error("Submit button not found");
    }

    console.log("🖱️ Clicking Continue (after email)...");

    // Click and wait for form transition
    await Promise.all([
      page.click(submitSelector),
      // Wait for either navigation or form change
      Promise.race([
        page
          .waitForNavigation({ waitUntil: "networkidle0", timeout: 15000 })
          .catch(() => null),
        sleep(2000), // Fallback for SPA transitions
      ]),
    ]);

    // Password step with multiple fallback selectors
    console.log("⏳ Waiting for password field to become visible...");
    const possiblePasswordSelectors = [
      selectors.passwordInput,
      'input[type="password"]',
      'input[name="password"]',
      'input[autocomplete*="password"]',
      '[data-testid="password-input"]',
      "#password",
      ".password-input",
    ];

    let foundPasswordSelector: string | null = null;
    for (const sel of possiblePasswordSelectors) {
      const handle = await page
        .waitForSelector(sel, { visible: true, timeout: 10000 })
        .catch(() => null);
      if (handle) {
        foundPasswordSelector = sel;
        break;
      }
    }

    if (!foundPasswordSelector) {
      // Take screenshot for debugging
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

    // Wait a bit for any client-side validation
    await sleep(500);

    // Find submit button again (might have changed)
    let finalSubmitSelector: string | null = null;
    for (const sel of possibleSubmitSelectors) {
      const handle = await page
        .waitForSelector(sel, { visible: true, timeout: 5000 })
        .catch(() => null);
      if (handle) {
        finalSubmitSelector = sel;
        break;
      }
    }

    if (!finalSubmitSelector) {
      throw new Error("Final submit button not found");
    }

    console.log("🖱️ Clicking Continue (after password)...");

    // Handle different types of post-login flows
    await Promise.race([
      // Traditional navigation-based login
      (async () => {
        await Promise.all([
          page.waitForNavigation({ waitUntil: "networkidle0", timeout: 30000 }),
          page.click(finalSubmitSelector!),
        ]);
      })(),

      // SPA-based login (no navigation)
      (async () => {
        await page.click(finalSubmitSelector!);
        // Wait for login button to disappear OR success indicator to appear
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

    // Wait for full authentication to complete
    console.log("⏳ Waiting for full authentication...");
    await waitForFullAuthentication(page);

    // Final verification that login was successful
    const stillHasLogin = await page.$(selectors.loginButton);
    if (stillHasLogin) {
      // Take screenshot for debugging
      await page.screenshot({ path: "login-failed.png", fullPage: true });
      console.warn(
        "⚠️ Login button still present after submit — login may have failed."
      );
    } else {
      console.log(
        "✅ Login button no longer present - login likely successful"
      );
    }

    console.log("✅ Login flow completed. Collecting cookies...");
    const hostname = new globalThis.URL(TARGET_URL).hostname;
    const savedCookies = await getFormattedCookies(browser, hostname);

    // Verify cookies work
    await verifyCookies(browser, savedCookies, TARGET_URL);

    return savedCookies;
  } finally {
    // Always close the browser to prevent resource leaks
    await browser.close();
  }
};

const waitForFullAuthentication = async (page: Page): Promise<void> => {
  // Wait for common post-login elements or processes
  console.log("⏳ Waiting for authentication to complete...");

  // Wait a base amount of time for cookies to be set
  await sleep(3000);

  // Try to wait for common authenticated page elements
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

  // Additional wait for any async cookie setting
  await sleep(2000);

  // Wait for any pending network requests to complete
  await page
    .waitForNetworkIdle({ timeout: 10000 })
    .catch(() => {
      console.log("⏳ Network idle wait not available or timed out");
    });
};

const getFormattedCookies = async (
  browser: Browser,
  filterHost?: string
): Promise<any[]> => {
  console.log("🍪 Collecting cookies from all browser contexts...");

  // Get cookies from all pages and contexts
  let allCookies: any[] = [];

  // Get cookies from default browser context
  const defaultCookies = await browser.defaultBrowserContext().cookies();
  allCookies = allCookies.concat(defaultCookies);

  // Get cookies from all pages
  const pages = await browser.pages();
  for (const page of pages) {
    try {
      const pageCookies = await page.cookies();
      allCookies = allCookies.concat(pageCookies);
    } catch (e) {
      console.warn("Could not get cookies from page:", e);
    }
  }

  // Remove duplicates based on name, domain, and path
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
    // Be more permissive with subdomains
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

  const formattedCookies = filtered.map((cookie) => {
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

  // Log cookie details for debugging
  console.log("🍪 Cookie summary:");
  formattedCookies.forEach((cookie) => {
    console.log(
      `  - ${cookie.name}: ${cookie.domain}${cookie.path} (${
        cookie.session ? "session" : "persistent"
      })`
    );
  });

  return formattedCookies;
};

const verifyCookies = async (
  browser: Browser,
  cookies: any[],
  targetUrl: string
): Promise<void> => {
  console.log("🧪 Verifying cookies work for authentication...");

  const testPage = await browser.newPage();

  try {
    // Set all cookies
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

    // Navigate to the target URL
    await testPage.goto(targetUrl, { waitUntil: "domcontentloaded" });
    await new Promise((resolve) => setTimeout(resolve, 3000)); // Wait for any auth checks

    // Check if logged in by looking for login button absence
    const loginButton = await testPage
      .$(selectors.loginButton)
      .catch(() => null);
    const isLoggedIn = !loginButton;

    if (isLoggedIn) {
      console.log(
        "✅ Cookie verification successful - appears to be logged in"
      );
    } else {
      console.log(
        "⚠️  Cookie verification failed - login button still present"
      );

      // Additional checks for auth indicators
      const authIndicators = [
        '[data-testid="user-menu"]',
        ".user-avatar",
        ".logout-button",
        '[data-testid="dashboard"]',
      ];

      let foundAuthIndicator = false;
      for (const indicator of authIndicators) {
        const element = await testPage.$(indicator).catch(() => null);
        if (element) {
          console.log(
            `✅ Found auth indicator: ${indicator} - cookies might still work`
          );
          foundAuthIndicator = true;
          break;
        }
      }

      if (!foundAuthIndicator) {
        console.warn(
          "⚠️  No authentication indicators found - cookies may not be working"
        );
      }
    }
  } catch (error) {
    console.error("❌ Cookie verification failed:", error);
  } finally {
    await testPage.close();
  }
};

// Export utility function to use cookies in other contexts
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

// Small sleep utility compatible with Puppeteer types
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
