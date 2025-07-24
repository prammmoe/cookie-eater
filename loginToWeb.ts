import puppeteer, { Browser } from 'puppeteer';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'fs/promises';
import 'dotenv/config';



export const loginToWeb = async (): Promise<any[]> => {
  const IS_HEADLESS = process.env.ENVIRONMENT === 'PRODUCTION';
  const EMAIL = process.env.EMAIL ?? '';
  const PASSWORD = process.env.PASSWORD ?? '';

  if (!EMAIL || !PASSWORD) {
    // throw new Error('❌ EMAIL or PASSWORD not set in environment variables');
    return [];
  }

  const browser = await puppeteer.launch({
    headless: IS_HEADLESS,
  });

  const page = await browser.newPage();
  await page.goto(process.env.WEB_URL ?? '', { waitUntil: 'networkidle2' });

  const loginBtn = await page.$('a[href="/login"]');

  if (!loginBtn) {
    console.log('✅ Already logged in — saving cookies only.');
    return await saveCookies(browser);
  }

  console.log('🔓 Not logged in, clicking login...');
  await loginBtn.click();
  await page.waitForNavigation({ waitUntil: 'networkidle2' });

  // Wait for email input and type
  const emailSelector = 'input[type="email"]';
  await page.waitForSelector(emailSelector, { visible: true });
  console.log('⌨️ Typing email...');
  await page.type(emailSelector, EMAIL, { delay: 100 });

  // Click Continue
  const continueBtnSelector = 'button[type="submit"][data-sentry-component="SubmitButton"]';
  await page.waitForSelector(continueBtnSelector, { visible: true });
  console.log('🖱️ Clicking Continue (after email)...');
  await page.click(continueBtnSelector);

  // Wait for password input to become visible and interactive
  const passwordSelector = 'input[type="password"][name="password"]';
  console.log('⏳ Waiting for password field to become visible...');
  await page.waitForFunction(
    selector => {
      const el = document.querySelector<HTMLInputElement>(selector);
      return !!el && el.offsetParent !== null;
    },
    { timeout: 15000 },
    passwordSelector
  );

  console.log('🔒 Typing password...');
  await page.evaluate((selector) => {
    const input = document.querySelector<HTMLInputElement>(selector);
    if (input) {
      input.focus();
      input.value = '';
    }
  }, passwordSelector);

  await sleep(700);
  await page.type(passwordSelector, PASSWORD, { delay: 100 });

  // Click Continue after password
  await page.waitForSelector(continueBtnSelector, { visible: true });
  console.log('🖱️ Clicking Continue (after password)...');
  await page.click(continueBtnSelector);

  await sleep(3000);
  console.log('✅ Login flow completed.');

  const savedCookies = await saveCookies(browser);

  // close browser
  await browser.close();

  return savedCookies;
};

const saveCookies = async (browser: Browser, filename: string = 'cookies.json') => {
  const cookies = await browser.defaultBrowserContext().cookies();

  const formattedCookies = cookies.map(cookie => ({
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
    value: cookie.value
  }));

  // await fs.writeFile(filename, JSON.stringify(formattedCookies, null, 2));
  // console.log(`🍪 Cookies saved to ${filename}`);

  return formattedCookies;
};
