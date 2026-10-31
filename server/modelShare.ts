import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect, Plugin } from 'vite';
import { buildBambuProject } from './bambuProfile.ts';

// Slicers like Bambu Studio open models by downloading them from an http(s)
// URL, which a file generated in the browser doesn't have. This middleware
// lets the page upload a model to the local dev/preview server and get back a
// URL the slicer can fetch.
//
//   POST /api/models/<name>.3mf        body: the file      -> { url }
//   GET  /api/models/<id>/<name>.3mf                        -> the file
//   GET  /api/bambu/project            Bambu Studio project settings for a
//                                      single Generic PLA filament (see bambuProfile.ts)

const MAX_BYTES = 64 * 1024 * 1024;
const MAX_MODELS = 20;
const NAME = /^[\w-]{1,80}\.3mf$/;

interface Stored {
  name: string;
  body: Buffer;
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BYTES) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function modelShare(): Plugin {
  const models = new Map<string, Stored>();

  const handler: Connect.NextHandleFunction = async (req, res: ServerResponse, next) => {
    const path = (req.url ?? '').split('?')[0];
    if (req.method === 'GET' && path === '/api/bambu/project') {
      const project = buildBambuProject();
      res.statusCode = 'error' in project ? 404 : 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(project));
      return;
    }
    if (!path.startsWith('/api/models/')) return next();
    const segments = path.slice('/api/models/'.length).split('/').map(decodeURIComponent);

    if (req.method === 'POST' && segments.length === 1 && NAME.test(segments[0])) {
      try {
        const body = await readBody(req);
        const id = randomUUID();
        models.set(id, { name: segments[0], body });
        // Keep memory bounded: drop the oldest uploads.
        while (models.size > MAX_MODELS) models.delete(models.keys().next().value!);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ url: `/api/models/${id}/${encodeURIComponent(segments[0])}` }));
      } catch {
        res.statusCode = 413;
        res.end();
      }
      return;
    }

    if (req.method === 'GET' && segments.length === 2) {
      const model = models.get(segments[0]);
      // Logged so it's visible in the terminal when the slicer fetches a model.
      console.log(`[model-share] ${model ? 'sent' : 'unknown model'} ${segments[1]} to ${req.headers['user-agent'] ?? 'unknown client'}`);
      if (model && model.name === segments[1]) {
        res.setHeader('Content-Type', 'model/3mf');
        res.setHeader('Content-Length', model.body.length);
        res.end(model.body);
        return;
      }
    }

    res.statusCode = 404;
    res.end();
  };

  return {
    name: 'model-share',
    configureServer: (server) => void server.middlewares.use(handler),
    configurePreviewServer: (server) => void server.middlewares.use(handler),
  };
}
