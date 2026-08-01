import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', 'public');
const port = Number(process.env.PORT || 4173);
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.txt':'text/plain; charset=utf-8' };

function sendJson(res, status, data) {
  res.writeHead(status, { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store' });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function mockPreview(topic) {
  const words = String(topic || '').split(/\s+/).filter((word) => word.length > 2).slice(0, 6);
  return {
    source:'local-demonstration', normalizedQuery:String(topic || '').trim(),
    entities:words.map((label,index)=>({label,type:index===0?'core term':'query term'})),
    synonyms:['allele-specific inhibition','targeted therapy','tumor signaling'],
    estimatedCount:184, earliestYear:2008, latestYear:2026,
    samples:[
      { title:'Illustrative sample: early mechanism study', year:2012, source:'Local preview' },
      { title:'Illustrative sample: structure-guided drug discovery', year:2022, source:'Local preview' },
      { title:'Illustrative sample: translational biomarker report', year:2025, source:'Local preview' },
    ],
  };
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/api/health') return sendJson(res, 200, { ok:true, service:'oncoreplay-local', timestamp:new Date().toISOString() });
    if (url.pathname === '/api/query/preview' && req.method === 'POST') {
      const body = await readBody(req);
      return sendJson(res, 200, mockPreview(body.topic));
    }
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.includes('..')) return sendJson(res, 400, { error:'Invalid path' });
    let filePath = join(root, normalize(pathname).replace(/^[/\\]+/, ''));
    try {
      const info = await stat(filePath);
      if (info.isDirectory()) filePath = join(filePath, 'index.html');
    } catch {
      filePath = join(root, 'index.html');
    }
    const data = await readFile(filePath);
    res.writeHead(200, { 'content-type': types[extname(filePath)] || 'application/octet-stream', 'cache-control':'no-cache' });
    res.end(data);
  } catch (error) {
    sendJson(res, 500, { error:error.message });
  }
});
server.listen(port, '0.0.0.0', () => console.log(`OncoReplay local server: http://localhost:${port}`));
