// Deployed entry point. esbuild inlines the two data files as text/JSON, so the
// Worker needs no filesystem, no bindings and no database: rebuild and redeploy
// when the export changes.
import csvText from '../data/registrations.csv';
import eventsJson from '../data/events.json';
import { createHandler } from './handler.js';

const handle = createHandler(() => ({ csvText, eventsJson }));

export default {
  fetch: handle,
};
