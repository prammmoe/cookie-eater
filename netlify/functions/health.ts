import "dotenv/config";

export async function handler() {
  const ENV = process.env.ENVIRONMENT || "PRODUCTION";
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      status: "ok",
      timestamp: new Date().toISOString(),
      environment: ENV,
    }),
  };
}