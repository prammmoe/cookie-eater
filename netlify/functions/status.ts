import "dotenv/config";

export async function handler() {
  const ENV = process.env.ENVIRONMENT || "PRODUCTION";

  const requiredEnvVars = ["EMAIL", "PASSWORD", "WEB_URL"] as const;
  const missingVars = requiredEnvVars.filter((varName) => !process.env[varName]);

  const payload = {
    status: "ok",
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
    uptime: process.uptime(),
  };

  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  };
}