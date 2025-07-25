import puppeteer, { Browser } from 'puppeteer';
import 'dotenv/config';
import { selectors } from './selectors';

export const loginToWeb = async (): Promise<any[]> => {
  const IS_HEADLESS = process.env.ENVIRONMENT === 'PRODUCTION';
  const EMAIL = process.env.EMAIL ?? '';
  const PASSWORD = process.env.PASSWORD ?? '';


  if (!EMAIL || !PASSWORD) {
    throw new Error('❌ EMAIL or PASSWORD not set in environment variables');
  }

  console.log('🚀 Launching browser...');

  const browser = await puppeteer.launch({
    headless: IS_HEADLESS,
    args: ["--no-sandbox"],
  });
  console.log('🚀 Browser launched.');

  console.log('Opening login page...');
  const page = await browser.newPage();

  const URL = process.env.WEB_URL ?? ''
  console.log(`🚀 Navigating to ${URL}...`);

  await page.goto(URL, { waitUntil: ['load', 'domcontentloaded'], timeout:120000 });
  console.log('✅ Login page opened.');

  const loginBtn = await page.$(selectors.loginButton);

  if (!loginBtn) {
    console.log('✅ Already logged in — saving cookies only.');
    return await getFormattedCookies(browser);
  }

  console.log('🔓 Not logged in, clicking login...');
  await loginBtn.click();

  // Wait for email input and type
  await page.waitForSelector(selectors.emailInput, { visible: true });
  console.log('⌨️ Typing email...');
  await page.type(selectors.emailInput, EMAIL, { delay: 100 });

  // Click Continue
  await page.waitForSelector(selectors.submitButton, { visible: true });
  console.log('🖱️ Clicking Continue (after email)...');
  await page.click(selectors.submitButton);

  // Wait for password input to become visible and interactive
  console.log('⏳ Waiting for password field to become visible...');
  await page.waitForFunction(
    (selector) => {
      const el = document.querySelector<HTMLInputElement>(selector);
      return !!el && el.offsetParent !== null;
    },
    { timeout: 15000 },
    selectors.passwordInput,
  );

  console.log('🔒 Typing password...');
  await page.evaluate((selector) => {
    const input = document.querySelector<HTMLInputElement>(selector);
    if (input) {
      input.focus();
      input.value = '';
    }
  }, selectors.passwordInput);

  await page.type(selectors.passwordInput, PASSWORD, { delay: 100 });

  // Click Continue after password
  await page.waitForSelector(selectors.submitButton, { visible: true });
  console.log('🖱️ Clicking Continue (after password)...');
  await page.click(selectors.submitButton);

  console.log('⏳ Waiting for navigation after login...');
  console.log('✅ Login flow completed.');
  await new Promise((resolve) => setTimeout(resolve, 5000));

  const savedCookies = await getFormattedCookies(browser);

  // close browser
  await browser.close();

  return savedCookies;
};

const getFormattedCookies = async (browser: Browser): Promise<any[]> => {
  const cookies = await browser.defaultBrowserContext().cookies();

  const formattedCookies = cookies.map((cookie) => ({
    domain: cookie.domain,
    expirationDate: cookie.expires ?? undefined,
    hostOnly: !cookie.domain.startsWith('.'),
    httpOnly: cookie.httpOnly,
    name: cookie.name,
    path: cookie.path,
    sameSite: cookie.sameSite?.toLowerCase() ?? null,
    secure: cookie.secure,
    session: !cookie.expires,
    storeId: null,
    value: cookie.value,
  }));

  return formattedCookies;
};

