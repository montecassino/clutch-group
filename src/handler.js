// Routes, with the data source injected. The Node dev server reads files from
// disk; the deployed Worker gets the same CSV and JSON bundled at build time.
// Nothing here touches the filesystem, so both run the identical code path.

import { buildModel, renderAlert } from './model.js';
import { renderPage } from './views.js';

const TTL_MS = 2_000;

const html = (body, status = 200) =>
  new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });

export function createHandler(getSources) {
  let cache = { at: 0, model: null };

  async function loadModel() {
    const now = Date.now();
    if (cache.model && now - cache.at < TTL_MS) return cache.model;
    const { csvText, eventsJson } = await getSources();
    const model = buildModel({ csvText, eventsJson, now: new Date() });
    cache = { at: now, model };
    return model;
  }

  return async function handle(request) {
    const { pathname } = new URL(request.url);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405 });
    }

    if (pathname === '/healthz') {
      try {
        const model = await loadModel();
        return Response.json({ ok: true, events: model.events.length, generatedAt: model.generatedAt });
      } catch (error) {
        return Response.json({ ok: false, error: String(error) }, { status: 500 });
      }
    }

    let model;
    try {
      model = await loadModel();
    } catch (error) {
      return html(`<pre>Could not load data:\n${String(error)}</pre>`, 500);
    }

    if (pathname === '/api/report.json') {
      return Response.json(model, { headers: { 'cache-control': 'no-store' } });
    }

    if (pathname === '/alert.txt') {
      return new Response(renderAlert(model), {
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
      });
    }

    if (pathname === '/' || pathname === '/index.html') return html(renderPage(model));

    return html('<h1>404</h1><p><a href="/">Registration report</a></p>', 404);
  };
}
