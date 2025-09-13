import type { VercelRequest, VercelResponse } from "@vercel/node";

export default function handler(_req: VercelRequest, res: VercelResponse) {
  const ENV = process.env.ENVIRONMENT || "PRODUCTION";
  const requiredEnvVars = ["EMAIL", "PASSWORD", "WEB_URL"];
  const missingVars = requiredEnvVars.filter((v) => !process.env[v]);

  res.status(200).json({
    environment: ENV,
    timestamp: new Date().toISOString(),
    configuration: {
      hasEmail: !!process.env.EMAIL,
      hasPassword: !!process.env.PASSWORD,
      hasWebUrl: !!process.env.WEB_URL,
      webUrl: process.env.WEB_URL ? process.env.WEB_URL.replace(/\/+$/, "") : null,
    },
    missingConfiguration: missingVars,
    isConfigured: missingVars.length === 0,
  });
}

