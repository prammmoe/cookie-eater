import type { VercelRequest, VercelResponse } from "@vercel/node";

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ success: false, error: "Method Not Allowed" });
  }

  let cookies: any[] | undefined;
  try {
    if (typeof req.body === "string") {
      const parsed = JSON.parse(req.body || "{}");
      cookies = parsed.cookies;
    } else {
      cookies = (req.body as any)?.cookies;
    }
  } catch (e) {
    return res.status(400).json({ success: false, error: "Invalid JSON body" });
  }

  if (!cookies || !Array.isArray(cookies)) {
    return res.status(400).json({
      success: false,
      error: "Invalid request body",
      message: 'Expected "cookies" array in request body',
    });
  }

  const requestId = Math.random().toString(36).substring(7);
  console.log(`🧪 [${requestId}] Validating ${cookies.length} cookies...`);

  try {
    const validCookies = cookies.filter(
      (cookie) => cookie && cookie.name && cookie.value && cookie.domain
    );
    const sessionCookies = validCookies.filter((c) => c.session);
    const persistentCookies = validCookies.filter((c) => !c.session);

    return res.status(200).json({
      success: true,
      requestId,
      timestamp: new Date().toISOString(),
      validation: {
        total: cookies.length,
        valid: validCookies.length,
        invalid: cookies.length - validCookies.length,
        session: sessionCookies.length,
        persistent: persistentCookies.length,
      },
      cookies: validCookies,
    });
  } catch (err: any) {
    console.error(`❌ [${requestId}] Cookie validation failed:`, err.message);
    return res.status(500).json({
      success: false,
      error: "Cookie validation failed",
      message: err.message,
      requestId,
    });
  }
}

