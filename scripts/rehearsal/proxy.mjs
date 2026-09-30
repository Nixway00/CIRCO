import http from 'node:http';
// Supabase clients call <url>/rest/v1/...; PostgREST serves at /. This strips the prefix.
http.createServer((req, res) => {
  const path = req.url.replace(/^\/rest\/v1/, '');
  const p = http.request({ host: '127.0.0.1', port: 3001, path, method: req.method, headers: { ...req.headers, host: '127.0.0.1:3001' } }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  p.on('error', e => { res.writeHead(502); res.end(String(e)); });
  req.pipe(p);
}).listen(54321, () => console.log('proxy on 54321'));
