import { loginToWeb } from "../../loginToWeb";

// Netlify Function handler: POST-only, with CORS and preflight support
export async function handler(event: any): Promise<{
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
}> {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "content-type": "application/json",
  } as const;

  // Handle CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: corsHeaders,
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { ...corsHeaders, Allow: "POST, OPTIONS" },
      body: JSON.stringify({
        success: false,
        error: "Method Not Allowed",
        message: "Use POST to trigger login-to-web",
      }),
    };
  }

  try {
    // Optional: allow overriding credentials via JSON body
    let body: any = {};
    if (event.body) {
      try {
        body = JSON.parse(event.body);
      } catch {
        // ignore parse errors, stick to env vars
      }
    }

    if (body && typeof body === "object") {
      if (body.EMAIL) process.env.EMAIL = String(body.EMAIL);
      if (body.PASSWORD) process.env.PASSWORD = String(body.PASSWORD);
      if (body.WEB_URL) process.env.WEB_URL = String(body.WEB_URL);
    }

    const cookies = await loginToWeb();
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(cookies),
    };
  } catch (err: any) {
    const message = err?.message || "Unknown error";
    return {
      statusCode: err?.statusCode || 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: "Web login failed", message }),
    };
  }
}