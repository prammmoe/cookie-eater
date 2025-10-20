// puppeteerManager.ts
import puppeteer, { Browser, Page } from "puppeteer-core";
import fs from "fs";
import path from "path";

let sharedBrowser: Browser | null = null;

// --- Concurrency (tetap) ---
type Task<T> = () => Promise<T>;
let queueConcurrency = 3;
let activeCount = 0;
const taskQueue: Array<{ run: () => void }> = [];
let useInternalQueue = true;
let pQueueInstance: any = null;

async function getPQueue() {
  if (pQueueInstance) return pQueueInstance;
  try {
    const mod: any = await import("p-queue");
    const PQueueCtor = mod?.default ?? mod;
    pQueueInstance = new PQueueCtor({ concurrency: queueConcurrency });
    useInternalQueue = false;
  } catch {
    useInternalQueue = true;
  }
  return pQueueInstance;
}

function enqueueInternal<T>(task: Task<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = async () => {
      activeCount++;
      try {
        const res = await task();
        resolve(res);
      } catch (e) {
        reject(e);
      } finally {
        activeCount--;
        const next = taskQueue.shift();
        if (next) next.run();
      }
    };
    if (activeCount < queueConcurrency) run();
    else taskQueue.push({ run });
  });
}

export const setConcurrency = (concurrency: number) => {
  queueConcurrency = Math.max(1, concurrency);
  if (pQueueInstance && !useInternalQueue) {
    pQueueInstance.concurrency = queueConcurrency;
  }
};

// --- Launch Chromium yang kompatibel serverless ---
export const getBrowser = async (): Promise<Browser> => {
  if (sharedBrowser && sharedBrowser.connected) return sharedBrowser;

  const isServerless = Boolean(
    process.env.AWS_LAMBDA_FUNCTION_VERSION ||
      process.env.AWS_EXECUTION_ENV ||
      process.env.VERCEL ||
      process.env.NOW_REGION ||
      process.env.NETLIFY
  );

  const launchOptions: any = {
    headless: true,
    defaultViewport: { width: 1280, height: 800 },
  };

  if (isServerless) {
    const chromium = (await import("@sparticuz/chromium")).default;

    // pastikan /tmp tersedia untuk profile persistent
    const profileDir = "/tmp/chromium-profile";
    try {
      if (!fs.existsSync(profileDir))
        fs.mkdirSync(profileDir, { recursive: true });
    } catch (e) {
      console.warn("⚠️ Cannot create /tmp profile dir:", e);
    }

    launchOptions.args = [
      ...chromium.args,
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--single-process",
      "--no-zygote",
    ];
    launchOptions.executablePath = await chromium.executablePath();
    launchOptions.userDataDir = profileDir;

    console.log("ℹ️ Serverless launch");
    console.log("   • Chromium path:", launchOptions.executablePath);
    console.log("   • Profile dir:", launchOptions.userDataDir);
    console.log("   • /tmp writable:", fs.existsSync("/tmp"));
  } else {
    const candidates: string[] = [];

    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      candidates.push(process.env.PUPPETEER_EXECUTABLE_PATH);
    }
    if (process.platform === "darwin") {
      candidates.push(
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium"
      );
    } else if (process.platform === "win32") {
      candidates.push(
        path.join(
          process.env["PROGRAMFILES"] || "C:/Program Files",
          "Google/Chrome/Application/chrome.exe"
        ),
        path.join(
          process.env["PROGRAMFILES(X86)"] || "C:/Program Files (x86)",
          "Google/Chrome/Application/chrome.exe"
        )
      );
    } else {
      candidates.push(
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/snap/bin/chromium"
      );
    }

    const chosen = candidates.find((p) => p && fs.existsSync(p));
    if (chosen) launchOptions.executablePath = chosen;

    console.log(
      "ℹ️ Local launch • executable:",
      launchOptions.executablePath ?? "(bundled)"
    );
  }

  sharedBrowser = await puppeteer.launch(launchOptions);
  return sharedBrowser;
};

export const hasBrowser = (): boolean =>
  !!sharedBrowser && sharedBrowser.connected;

export const closeBrowser = async (): Promise<void> => {
  if (sharedBrowser) {
    try {
      await sharedBrowser.close();
    } catch {}
    sharedBrowser = null;
  }
};

// --- Helper page wrapper (tidak menutup sebelum callback selesai) ---
export const withPage = async <T>(
  fn: (page: Page, browser: Browser) => Promise<T>
): Promise<T> => {
  const runTask = async () => {
    const browser = await getBrowser();

    // pakai incognito agar konteks terisolasi tapi tetap persistent via userDataDir
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();

    page.setDefaultTimeout(30_000);
    page.setDefaultNavigationTimeout(60_000);
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    try {
      const result = await fn(page, browser);
      return result;
    } finally {
      try {
        await page.close();
      } catch {}
      try {
        await ctx.close();
      } catch {}
    }
  };

  const pq = await getPQueue();
  if (pq && !useInternalQueue) return pq.add(runTask);
  return enqueueInternal(runTask);
};
