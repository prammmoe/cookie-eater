// puppeteerManager.ts
import puppeteer, { Browser, Page } from "puppeteer-core";
import fs from "fs";
import path from "path";

let sharedBrowser: Browser | null = null;

// --- Concurrency ---
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

// --- Browser Management ---
async function verifyBrowser(browser: Browser | null): Promise<boolean> {
  if (!browser) return false;
  try {
    if (!browser.isConnected()) return false;
    await browser.version(); // ping browser
    return true;
  } catch {
    return false;
  }
}

// --- Launch Chromium yang stabil ---
export const getBrowser = async (): Promise<Browser> => {
  if (await verifyBrowser(sharedBrowser)) return sharedBrowser as Browser;

  const isServerless = Boolean(
    process.env.AWS_LAMBDA_FUNCTION_VERSION ||
      process.env.AWS_EXECUTION_ENV ||
      process.env.VERCEL ||
      process.env.NOW_REGION ||
      process.env.NETLIFY
  );

  console.log("🧭 Serverless runtime detected:", isServerless);

  const launchOptions: any = {
    headless: true,
    defaultViewport: { width: 1280, height: 800 },
  };

  if (isServerless) {
    const chromium = (await import("@sparticuz/chromium")).default;
    const profileDir = "/tmp/chromium-profile";

    try {
      if (!fs.existsSync(profileDir))
        fs.mkdirSync(profileDir, { recursive: true });
    } catch (e) {
      console.warn("⚠️ Cannot create /tmp profile dir:", e);
    }

    // Use recommended settings for Lambda/Vercel
    launchOptions.headless = (chromium as any).headless ?? true;
    launchOptions.defaultViewport = (chromium as any).defaultViewport ?? {
      width: 1280,
      height: 800,
    };
    launchOptions.ignoreDefaultArgs = (chromium as any).ignoreDefaultArgs ?? [];
    launchOptions.dumpio = true;
    launchOptions.protocolTimeout = Number(
      process.env.PUPPETEER_PROTOCOL_TIMEOUT ?? 300_000
    );
    // Prefer pipe over WebSocket; some serverless envs restrict sockets
    launchOptions.pipe = true;
    // Flags based on chromium defaults with safe additions
    launchOptions.args = [
      ...chromium.args.filter(
        (a) => !["--single-process", "--no-zygote"].includes(a)
      ),
      "--single-process",
      "--no-zygote",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--hide-scrollbars",
      "--mute-audio",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      "--disable-software-rasterizer",
      "--remote-debugging-port=0",
    ];

    launchOptions.executablePath = await chromium.executablePath();
    launchOptions.userDataDir = profileDir;
  } else {
    // Local fallback
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
  }

  try {
    console.log("🎯 Launching Chromium with options:", {
      headless: launchOptions.headless,
      protocolTimeout: launchOptions.protocolTimeout,
      pipe: launchOptions.pipe,
      executablePath: launchOptions.executablePath,
    });

    sharedBrowser = await puppeteer.launch(launchOptions);
    await new Promise((r) => setTimeout(r, 400)); // stabilisasi
  } catch (err: any) {
    console.error("⚠️ Puppeteer launch failed:", err.message);
    if (
      String(err.message).includes("Target closed") ||
      String(err.message).includes("Protocol error")
    ) {
      console.warn("🔁 Retrying with fresh profile...");
      try {
        fs.rmSync("/tmp/chromium-profile", { recursive: true, force: true });
      } catch {}
      const chromium = (await import("@sparticuz/chromium")).default;
      launchOptions.userDataDir = "/tmp/chromium-profile-fallback";
      launchOptions.executablePath = await chromium.executablePath();
      sharedBrowser = await puppeteer.launch(launchOptions);
    } else {
      throw err;
    }
  }

  console.log("✅ Chromium launched successfully");
  return sharedBrowser!;
};

export const hasBrowser = (): boolean =>
  !!sharedBrowser && sharedBrowser.isConnected();

export const closeBrowser = async (): Promise<void> => {
  if (sharedBrowser) {
    try {
      await sharedBrowser.close();
    } catch {}
    sharedBrowser = null;
  }
};

// --- Page Handler ---
export const withPage = async <T>(
  fn: (page: Page, browser: Browser) => Promise<T>,
  maxRetries = 2
): Promise<T> => {
  const runTask = async (): Promise<T> => {
    let lastError: any;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const browser = await getBrowser();
        const page = await browser.newPage();

        page.setDefaultTimeout(30_000);
        page.setDefaultNavigationTimeout(60_000);
        await page.setUserAgent(
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        );

        try {
          return await fn(page, browser);
        } finally {
          await page.close().catch(() => {});
        }
      } catch (error: any) {
        lastError = error;
        const isTargetClosed =
          error.message?.includes("Target closed") ||
          error.message?.includes("Protocol error");

        if (isTargetClosed && attempt < maxRetries) {
          console.warn(
            `🔁 Retry ${attempt + 1}/${maxRetries} due to: ${error.message}`
          );
          await closeBrowser();
          await new Promise((r) => setTimeout(r, 800));
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  };

  const pq = await getPQueue();
  if (pq && !useInternalQueue) return pq.add(runTask);
  return enqueueInternal(runTask);
};
