import { cronHandler } from './src/cron.ts';
import { serverHandler } from './src/server.ts';

// Execute at 10PM UTC (6PM EDT) every day
Deno.cron("Halton Region Environmental Assessments", '0 22 * * *', async () => {
  await cronHandler();
});

// Deno Deploy starts the app during warm-up and "waits for the HTTP server to
// start" before considering the deployment healthy — even for a cron-only
// worker. Without a listener, warm-up times out and the deploy fails. Serve a
// minimal health endpoint so the deploy passes; the cron above still fires on
// schedule. Deno.serve() binds to the platform-provided port automatically.
if (Deno.env.get('DENO_DEPLOYMENT_ID')) {
  Deno.serve(serverHandler);
} else {
  // In local dev there's no cron runtime, so run once immediately.
  await cronHandler();
}
