import { cronHandler } from './cron.ts';

export const serverHandler = (req: Request) => {
  if (req.method === 'GET' && req.url === '/cron/trigger') {
    cronHandler();
    return new Response(JSON.stringify({ message: 'Cron job triggered!' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (req.method === 'GET' && req.url === '/health') {
    return new Response(JSON.stringify({ status: 'ok' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response('Not Found', { status: 404 });
};