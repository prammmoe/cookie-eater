import express from "express";
import "dotenv/config";
import { loginToWeb } from "./loginToWeb";
import path from "path";

const app = express();
const PORT = process.env.PORT || 9900;
const ENV = process.env.ENVIRONMENT || "PRODUCTION";

// Middleware for parsing JSON and handling CORS if needed
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Add CORS headers if you need to call this from a frontend
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );
  next();
});

// Serve static frontend from /public
app.use(express.static(path.join(process.cwd(), "public")));

// Request timeout middleware (important for Puppeteer operations)
app.use((req, res, next) => {
  // Set timeout to 5 minutes for login operations
  req.setTimeout(300000);
  res.setTimeout(300000);
  next();
});

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    environment: ENV,
    uptime: process.uptime(),
  });
});

// Enhanced login endpoint with better error handling and logging
app.get("/login-to-web", async (req, res) => {
  const startTime = Date.now();
  const requestId = Math.random().toString(36).substring(7);

  console.log(`🔄 [${requestId}] Starting login process...`);

  try {
    // Validate environment variables before starting
    if (!process.env.EMAIL || !process.env.PASSWORD || !process.env.WEB_URL) {
      throw new Error(
        "Missing required environment variables: EMAIL, PASSWORD, or WEB_URL"
      );
    }

    const myCookies = await loginToWeb();
    const duration = Date.now() - startTime;

    console.log(
      `✅ [${requestId}] Login completed successfully in ${duration}ms`
    );
    console.log(`🍪 [${requestId}] Retrieved ${myCookies.length} cookies`);

    res.status(200).json(myCookies);
  } catch (err: any) {
    const duration = Date.now() - startTime;
    const errorMessage = err?.message || "Unknown error occurred";
    const errorStack = err?.stack || "No stack trace available";

    console.error(
      `❌ [${requestId}] Login failed after ${duration}ms:`,
      errorMessage
    );
    console.error(`📍 [${requestId}] Stack trace:`, errorStack);

    // Determine appropriate status code based on error type
    let statusCode = 500;
    if (errorMessage.includes("EMAIL") || errorMessage.includes("PASSWORD")) {
      statusCode = 400; // Bad Request for missing credentials
    } else if (
      errorMessage.includes("timeout") ||
      errorMessage.includes("navigation")
    ) {
      statusCode = 408; // Request Timeout
    } else if (
      errorMessage.includes("login") ||
      errorMessage.includes("authentication")
    ) {
      statusCode = 401; // Unauthorized for login failures
    }

    res.status(statusCode).json({
      success: false,
      error: "Web login failed",
      message: errorMessage,
      requestId,
      timestamp: new Date().toISOString(),
      duration: `${duration}ms`,
      // Only include stack in development
      ...(ENV !== "PRODUCTION" && { stack: errorStack }),
    });
  }
});

// Additional utility endpoints

// Get current login status (useful for debugging)
app.get("/status", (req, res) => {
  const requiredEnvVars = ["EMAIL", "PASSWORD", "WEB_URL"];
  const missingVars = requiredEnvVars.filter(
    (varName) => !process.env[varName]
  );

  res.status(200).json({
    environment: ENV,
    timestamp: new Date().toISOString(),
    configuration: {
      hasEmail: !!process.env.EMAIL,
      hasPassword: !!process.env.PASSWORD,
      hasWebUrl: !!process.env.WEB_URL,
      webUrl: process.env.WEB_URL
        ? process.env.WEB_URL.replace(/\/+$/, "")
        : null,
    },
    missingConfiguration: missingVars,
    isConfigured: missingVars.length === 0,
  });
});

// Test endpoint that validates cookies (if you want to test retrieved cookies)
app.post("/validate-cookies", express.json(), async (req, res) => {
  const requestId = Math.random().toString(36).substring(7);
  const { cookies } = req.body;

  if (!cookies || !Array.isArray(cookies)) {
    return res.status(400).json({
      success: false,
      error: "Invalid request body",
      message: 'Expected "cookies" array in request body',
    });
  }

  console.log(`🧪 [${requestId}] Validating ${cookies.length} cookies...`);

  try {
    // Here you could implement cookie validation logic
    // For now, just return basic validation
    const validCookies = cookies.filter(
      (cookie) => cookie.name && cookie.value && cookie.domain
    );

    const sessionCookies = validCookies.filter((c) => c.session);
    const persistentCookies = validCookies.filter((c) => !c.session);

    res.status(200).json({
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
    res.status(500).json({
      success: false,
      error: "Cookie validation failed",
      message: err.message,
      requestId,
    });
  }
});

// Handle 404s (avoid path-to-regexp wildcard incompatibility by omitting path)
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Endpoint not found",
    availableEndpoints: [
      "GET /health",
      "GET /status",
      "GET /login-to-web",
      "POST /validate-cookies",
    ],
  });
});

// Global error handler
app.use(
  (
    err: any,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    console.error("🔥 Unhandled error:", err);

    res.status(500).json({
      success: false,
      error: "Internal server error",
      message: ENV === "PRODUCTION" ? "Something went wrong" : err.message,
      timestamp: new Date().toISOString(),
    });
  }
);

// Graceful shutdown handling
process.on("SIGINT", () => {
  console.log("\n🛑 Received SIGINT, shutting down gracefully...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n🛑 Received SIGTERM, shutting down gracefully...");
  process.exit(0);
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("🚨 Unhandled Rejection at:", promise, "reason:", reason);
});

console.log(`📁 Running in directory: ${process.cwd()}`);
console.log(`🌍 Environment: ${ENV}`);
console.log(`🔧 Configuration check:`);
console.log(`   - EMAIL: ${process.env.EMAIL ? "✅ Set" : "❌ Missing"}`);
console.log(`   - PASSWORD: ${process.env.PASSWORD ? "✅ Set" : "❌ Missing"}`);
console.log(`   - WEB_URL: ${process.env.WEB_URL ? "✅ Set" : "❌ Missing"}`);

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📋 Available endpoints:`);
  console.log(`   - GET  /health`);
  console.log(`   - GET  /status`);
  console.log(`   - GET  /login-to-web`);
  console.log(`   - POST /validate-cookies`);
});
