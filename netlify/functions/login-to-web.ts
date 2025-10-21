import { loginToWeb } from '../../loginToWeb';

// Netlify Function handler: bridges to our Puppeteer login flow
export async function handler(_event: any): Promise<{ statusCode: number; headers?: Record<string,string>; body: string; }> {
  try {
    const cookies = await loginToWeb();
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(cookies),
    };
  } catch (err: any) {
    const message = err?.message || 'Unknown error';
    return {
      statusCode: err?.statusCode || 500,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Web login failed', message }),
    };
  }
}