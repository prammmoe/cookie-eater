import "dotenv/config";
import app from "./app";
import { closeBrowser } from "./puppeteerManager";

const PORT = process.env.PORT || 9900;
const ENV = process.env.ENVIRONMENT || "PRODUCTION";

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

// Graceful shutdown handling
process.on("SIGINT", () => {
  console.log("\n🛑 Received SIGINT, shutting down gracefully...");
  closeBrowser().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  console.log("\n🛑 Received SIGTERM, shutting down gracefully...");
  closeBrowser().finally(() => process.exit(0));
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("🚨 Unhandled Rejection at:", promise, "reason:", reason);
});
