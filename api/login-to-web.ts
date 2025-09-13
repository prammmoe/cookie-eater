import type { VercelRequest, VercelResponse } from "@vercel/node";
import { loginToWeb } from "../loginToWeb";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ success: false, error: "Method Not Allowed" });
  }

  const startTime = Date.now();
  const ENV = process.env.ENVIRONMENT || "PRODUCTION";
  const requestId = Math.random().toString(36).substring(7);

  try {
    if (!process.env.EMAIL || !process.env.PASSWORD || !process.env.WEB_URL) {
      throw new Error(
        "Missing required environment variables: EMAIL, PASSWORD, or WEB_URL"
      );
    }

    const cookies = await loginToWeb();
    const duration = Date.now() - startTime;

    console.log(`✅ [${requestId}] Login completed successfully in ${duration}ms`);
    return res.status(200).json(cookies);
  } catch (err: any) {
    const duration = Date.now() - startTime;
    const errorMessage = err?.message || "Unknown error occurred";
    const errorStack = err?.stack || "No stack trace available";

    console.error(
      `❌ [${requestId}] Login failed after ${duration}ms:`,
      errorMessage
    );

    let statusCode = 500;
    if (errorMessage.includes("EMAIL") || errorMessage.includes("PASSWORD")) {
      statusCode = 400;
    } else if (
      errorMessage.includes("timeout") ||
      errorMessage.includes("navigation")
    ) {
      statusCode = 408;
    } else if (
      errorMessage.includes("login") ||
      errorMessage.includes("authentication")
    ) {
      statusCode = 401;
    }

    return res.status(statusCode).json({
      success: false,
      error: "Web login failed",
      message: errorMessage,
      requestId,
      timestamp: new Date().toISOString(),
      duration: `${duration}ms`,
      ...(ENV !== "PRODUCTION" && { stack: errorStack }),
    });
  }
}

