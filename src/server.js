// Local dev server. The app itself is a plain fetch handler, so this is the only
// Node-specific file: it supplies the data from disk instead of from the bundle.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHandler } from './handler.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const handle = createHandler(async () => {
  const [csvText, eventsJson] = await Promise.all([
    readFile(join(root, 'data', 'registrations.csv'), 'utf8'),
    readFile(join(root, 'data', 'events.json'), 'utf8'),
  ]);
  return { csvText, eventsJson: JSON.parse(eventsJson) };
});

// PORT is exported empty in some shells; Number('') is 0, which silently binds
// a random port. Only honour it when it is a real port number.
const requested = Number.parseInt(process.env.PORT ?? '', 10);
const port = Number.isInteger(requested) && requested > 0 ? requested : 4321;

const server = http.createServer(async (req, res) => {
  try {
    const request = new Request(`http://localhost:${port}${req.url}`, {
      method: req.method,
      headers: req.headers,
    });
    const response = await handle(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error(error);
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(String(error));
  }
});

server.listen(port, () => {
  console.log(`Registration report on http://localhost:${server.address().port}`);
});
