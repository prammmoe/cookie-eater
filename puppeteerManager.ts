import puppeteer, { Browser, Page } from "puppeteer-core";
import fs from "fs";
import path from "path";

// Shared browser instance for reuse
let sharedBrowser: Browser | null = null;

// Concurrency Control
type Task<T> = () => Promise<T>;
let queueConcurrency = 3;
let activeCount = 0;
const taskQueue: Array<{ run: () => void }> = [];

// Try to dynamically import p-queue if installed
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
    useInternalQueue = true; // fallback to internal queue
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

    if (activeCount < queueConcurrency) {
      run();
    } else {
      taskQueue.push({ run });
    }
  });
}

export const setConcurrency = (concurrency: number) => {
  queueConcurrency = Math.max(1, concurrency);
  if (pQueueInstance && !useInternalQueue) {
    pQueueInstance.concurrency = queueConcurrency;
  }
};

/**
 * Launch or reuse a serverless-optimized Chromium browser
 */
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
    defaultViewport: { width: 1280, height: 800 },
  };

  if (isServerless) {
    // Use Sparticuz Chromium only in serverless/Linux environments
    const chromium = (await import("@sparticuz/chromium")).default;
    launchOptions.args = chromium.args;
    launchOptions.executablePath = await chromium.executablePath();
  } else {
    // Local/dev: prefer a real Chrome/Chromium executable
    const candidates: string[] = [];

    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      candidates.push(process.env.PUPPETEER_EXECUTABLE_PATH);
    }

    // Common OS-specific defaults
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

    // Pick the first existing path
    const chosen = candidates.find((p) => p && fs.existsSync(p));
    if (chosen) {
      launchOptions.executablePath = chosen;
    }
  }

  sharedBrowser = await puppeteer.launch(launchOptions);

  return sharedBrowser;
};

export const hasBrowser = (): boolean => {
  return !!sharedBrowser && sharedBrowser.connected;
};

export const closeBrowser = async (): Promise<void> => {
  if (sharedBrowser) {
    try {
      await sharedBrowser.close();
    } catch {
      // Ignore close errors
    }
    sharedBrowser = null;
  }
};

/**
 * Run a Puppeteer task with an auto-managed page and concurrency handling
 */
export const withPage = async <T>(
  fn: (page: Page, browser: Browser) => Promise<T>
): Promise<T> => {
  const runTask = async () => {
    const browser = await getBrowser();
    const page = await browser.newPage();

    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(60000);
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    try {
      return await fn(page, browser);
    } finally {
      try {
        await page.close();
      } catch {
        // Ignore close errors
      }
    }
  };

  const pq = await getPQueue();
  if (pq && !useInternalQueue) {
    return pq.add(runTask);
  }
  return enqueueInternal(runTask);
};
