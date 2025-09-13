import app from "../app";

// Bridge Express app to Vercel serverless function
export default function handler(req: any, res: any) {
  // Express app is a request handler function with (req, res, next)
  // We can invoke it directly for basic routing.
  // Types differ slightly but are compatible at runtime.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (app as any)(req, res);
}
