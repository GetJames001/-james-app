const { createHash } = require('node:crypto');
const { configuredIdentity, requireAuth } = require('../auth.js');

const maxFileBytes = 2 * 1024 * 1024;
const fileLimit = 20;
const validId = id => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id);
const saveFile = `
  if redis.call('HEXISTS', KEYS[1], ARGV[1]) == 0 and
     redis.call('HLEN', KEYS[1]) >= tonumber(ARGV[4]) * 2 then return 0 end
  redis.call('HSET', KEYS[1], ARGV[1], ARGV[2], 'bytes:' .. ARGV[1], ARGV[3])
  return 1
`;
const listFiles = `
  local files = {}
  for _, id in ipairs(redis.call('HKEYS', KEYS[1])) do
    if string.len(id) == 64 then table.insert(files, redis.call('HGET', KEYS[1], id)) end
  end
  return files
`;

async function kv(...command) {
  const response = await fetch(process.env.KV_REST_API_URL, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
    headers: {
      Authorization: 'Bearer ' + process.env.KV_REST_API_TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(command)
  });
  const data = await response.json();
  if (!response.ok || data.error) throw Error('FILES_STORAGE_UNAVAILABLE');
  return data.result;
}

module.exports = async function files(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!requireAuth(req, res, { csrf: req.method !== 'GET' })) return;
  const environment = process.env.VERCEL_ENV === 'production' ? 'production' : 'preview';
  const account = createHash('sha256').update(configuredIdentity()).digest('hex');
  const key = `james:files:v1:${environment}:${account}`;
  const id = req.query?.id;

  try {
    if (req.method === 'GET') {
      if (id === undefined) {
        const entries = await kv('EVAL', listFiles, 1, key);
        return res.status(200).json({ files: entries.map(entry => JSON.parse(entry)) });
      }
      if (!validId(id)) return res.status(400).json({ error: 'INVALID_FILE_ID' });
      const [metadata, content] = await kv('HMGET', key, id, 'bytes:' + id);
      if (metadata === null || content === null) return res.status(404).json({ error: 'FILE_NOT_FOUND' });
      return res.status(200).json({ file: { ...JSON.parse(metadata), content } });
    }

    if (req.method === 'DELETE') {
      if (!validId(id)) return res.status(400).json({ error: 'INVALID_FILE_ID' });
      await kv('HDEL', key, id, 'bytes:' + id);
      return res.status(204).end();
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST, DELETE');
      return res.status(405).end();
    }
    if (!/^application\/json(?:;|$)/i.test(req.headers?.['content-type'] || '')) {
      return res.status(415).json({ error: 'JSON_REQUIRED' });
    }
    const { name, type, lastModified, content } = req.body || {};
    if (typeof name !== 'string' || !name.trim() || name.length > 255 ||
        typeof type !== 'string' || type.length > 127 ||
        !Number.isSafeInteger(lastModified) || lastModified < 0 ||
        typeof content !== 'string' || content.length > Math.ceil(maxFileBytes / 3) * 4) {
      return res.status(400).json({ error: 'INVALID_FILE' });
    }
    const bytes = Buffer.from(content, 'base64');
    if (bytes.length > maxFileBytes || bytes.toString('base64') !== content) {
      return res.status(400).json({ error: 'INVALID_FILE' });
    }
    const fileId = createHash('sha256').update(JSON.stringify([name, type, lastModified])).update(bytes).digest('hex');
    const metadata = { id: fileId, name, type, lastModified, size: bytes.length };
    const saved = await kv('EVAL', saveFile, 1, key, fileId, JSON.stringify(metadata), content, fileLimit);
    if (saved !== 1) return res.status(409).json({ error: 'FILES_LIMIT_REACHED' });
    return res.status(200).json({ file: metadata });
  } catch {
    return res.status(503).json({ error: 'FILES_STORAGE_UNAVAILABLE' });
  }
};
