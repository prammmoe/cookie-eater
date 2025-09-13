import chromium from "@sparticuz/chromium";
import puppeteer, { Browser, Page } from "puppeteer-core";

// Lazily-created shared browser instance
let sharedBrowser: Browser | null = null;

// Simple concurrency limiter (falls back if p-queue is unavailable)
type Task<T> = () => Promise<T>;

let queueConcurrency = 3;
let activeCount = 0;
const taskQueue: Array<{
  run: () => void;
}> = [];

// Try to use p-queue if available; otherwise use the minimal queue below
let useInternalQueue = true;
let pQueueInstance: any = null as any;

async function getPQueue() {
  if (pQueueInstance) return pQueueInstance;
  try {
    const mod: any = await import("p-queue");
    const PQueueCtor = mod?.default ?? mod;
    pQueueInstance = new PQueueCtor({ concurrency: queueConcurrency });
    useInternalQueue = false;
  } catch (err) {
    // Keep using internal queue if p-queue is not installed
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
        // Run next task if available
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
  // If using p-queue, update it too
  if (pQueueInstance && !useInternalQueue) {
    pQueueInstance.concurrency = queueConcurrency;
  }
};

export const getBrowser = async (): Promise<Browser> => {
  if (sharedBrowser && sharedBrowser.isConnected()) return sharedBrowser;

  // Prefer serverless-friendly Chromium when running on Vercel
  const executablePath = (await chromium.executablePath()) || process.env.CHROME_EXECUTABLE_PATH;
  if (!executablePath) {
    throw new Error(
      "Could not resolve a Chrome executable path. Set CHROME_EXECUTABLE_PATH or rely on @sparticuz/chromium."
    );
  }

  sharedBrowser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath,
    headless: chromium.headless,
  });
  return sharedBrowser;
};

export const hasBrowser = (): boolean => {
  return !!sharedBrowser && sharedBrowser.isConnected();
};

export const closeBrowser = async (): Promise<void> => {
  if (sharedBrowser) {
    try {
      await sharedBrowser.close();
    } catch {}
    sharedBrowser = null;
  }
};

export const withPage = async <T>(
  fn: (page: Page, browser: Browser) => Promise<T>
): Promise<T> => {
  const runTask = async () => {
    const browser = await getBrowser();
    const page = await browser.newPage();

    // Set sensible defaults for all pages
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
      } catch {}
    }
  };

  // Prefer p-queue if available
  const pq = await getPQueue();
  if (pq && !useInternalQueue) {
    return pq.add(runTask);
  }
  // Fallback to internal simple queue
  return enqueueInternal(runTask);
};
