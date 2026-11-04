const { requireAuth } = require('../auth.js');
const { createComposeGraph } = require('../microsoft/compose-graph.js');
const { reviewDraft, sendReviewedDraft } = require('../microsoft/compose.js');

async function kv(...command) {
  const response = await fetch(process.env.KV_REST_API_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.KV_REST_API_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(8000)
  });
  const data = await response.json();
  if (!response.ok || data.error) throw Error('MAIL_STORAGE_UNAVAILABLE');
  return data.result;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  if (!requireAuth(req, res, { csrf: true })) return;
  const { action, id, revision, to, subject, message, files } = req.body || {};
  if (!['prepare', 'send', 'status', 'edit', 'save', 'drafts', 'open', 'discard'].includes(action)) return res.status(400).json({ error: 'INVALID_ACTION' });
  try {
    const refresh = await kv('GET', 'microsoft:personal:refresh_token');
    if (!refresh) throw Error('MAIL_PERMISSION_REQUIRED');
    const tokenResponse = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: process.env.MICROSOFT_CLIENT_ID,
        client_secret: process.env.MICROSOFT_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: refresh,
        scope: 'User.Read Mail.ReadWrite Mail.Send offline_access'
      }),
      signal: AbortSignal.timeout(8000)
    });
    const token = await tokenResponse.json();
    const scopes = (token.scope || '').toLowerCase().split(/\s+/);
    if (!tokenResponse.ok || !token.access_token || !['mail.readwrite', 'mail.send'].every(scope => scopes.includes(scope))) {
      throw Error('MAIL_PERMISSION_REQUIRED');
    }
    const graph = createComposeGraph(token.access_token);
    const mailbox = await graph.verifyMailbox();
    const key = draftId => 'james:outlook:compose:' + mailbox + ':' + draftId;
    if (action === 'drafts') {
      const drafts = await graph.listDrafts();
      return res.status(200).json({ drafts: drafts.value });
    }
    const validId = typeof id === 'string' && /^[A-Za-z0-9_+=/-]{1,1024}$/.test(id);
    if (['open','discard'].includes(action) || (id !== undefined && ['save','prepare'].includes(action))) {
      if (!validId || await kv('GET', key(id) + ':submitted')) throw Error('DRAFT_REVIEW_REQUIRED');
      const {draft, attachments} = await graph.readDraft(id);
      const review = reviewDraft(mailbox,draft,attachments);
      if (action === 'open') return res.status(200).json({id,review});
      const revoked = await kv('EVAL',
        "if redis.call('GET', KEYS[2]) then return 0 end redis.call('DEL', KEYS[1]); return 1",
        '2', key(id) + ':review', key(id) + ':submitted');
      if (revoked !== 1) throw Error('DRAFT_REVIEW_REQUIRED');
      if (action === 'discard') {
        await graph.discardDraft(id);
        return res.status(200).json({status:'discarded'});
      }
    }
    if (['prepare','save'].includes(action)) {
      if (!Array.isArray(to) || (action === 'prepare' && !to.length) || to.length > 20 || to.some(address => typeof address !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) ||
          typeof subject !== 'string' || subject.length > 250 || typeof message !== 'string' || message.length > 30000 ||
          !Array.isArray(files) || files.length > 10 || files.some(file => typeof file?.name !== 'string' || !file.name || typeof file.contentBytes !== 'string') ||
          files.reduce((total, file) => total + file.contentBytes.length, 0) > 3000000) {
        return res.status(400).json({ error: 'INVALID_DRAFT' });
      }
      const draftFields = {
        toRecipients: to.map(address => ({ emailAddress: { address } })),
        subject, body: { contentType: 'text', content: message }
      };
      const created = id ? await graph.updateDraft(id,draftFields) : await graph.createDraft(draftFields);
      const previousIds = new Set(id ? (await graph.readDraft(created.id)).attachments.map(file=>file.id) : []);
      const missing = [];
      const uploadFailures = new Map();
      for (const file of files) {
        try { await graph.addAttachment(created.id, file); }
        catch (error) { uploadFailures.set(file, error.status || 'request failed'); }
      }
      const { draft, attachments } = await graph.readDraft(created.id);
      const remaining = new Map();
      for (const attachment of attachments.filter(file=>!previousIds.has(file.id))) {
        try {
          remaining.set(attachment.id, await graph.readAttachment(created.id, attachment.id));
        } catch (error) {
          remaining.set(attachment.id, { name: attachment.name, readError: error.status || 'request failed' });
        }
      }
      const issues = [];
      for (const file of files) {
        const expected = Buffer.from(file.contentBytes, 'base64');
        const match = [...remaining].find(([, saved]) => saved.name === file.name &&
          typeof saved.contentBytes === 'string' && Buffer.from(saved.contentBytes, 'base64').equals(expected));
        if (match) {
          remaining.delete(match[0]);
          continue;
        }
        missing.push(file.name);
        const readError = [...remaining.values()].find(saved => saved.name === file.name)?.readError;
        const failure = uploadFailures.get(file);
        issues.push(file.name + (failure ? ' (Outlook upload: ' + failure + ')' :
          readError ? ' (Outlook read-back: ' + readError + ')' : ' (saved file could not be matched)'));
      }
      if (missing.length || remaining.size) {
        return res.status(422).json({ id: created.id, error: 'ATTACHMENTS_NOT_VERIFIED', missing, issues });
      }
      const review = reviewDraft(mailbox, draft, attachments);
      if (action === 'prepare') await kv('SET', key(created.id) + ':review', review.revision);
      return res.status(200).json({ id: created.id, review });
    }
    if (typeof id !== 'string' || !/^[A-Za-z0-9_+=/-]{1,1024}$/.test(id) ||
        typeof revision !== 'string' || !/^[0-9a-f]{64}$/.test(revision) ||
        await kv('GET', key(id) + ':review') !== revision) {
      return res.status(409).json({ error: 'DRAFT_REVIEW_REQUIRED' });
    }
    const claimKey = key(id) + ':submitted';
    if (action === 'status') {
      const submitted = await kv('GET', claimKey);
      return res.status(200).json(submitted ? await graph.confirmSubmission(id) : { status: 'not_submitted' });
    }
    if (action === 'edit') {
      const revoked = await kv('EVAL',
        "if redis.call('GET', KEYS[2]) or redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end return redis.call('DEL', KEYS[1])",
        '2', key(id) + ':review', claimKey, revision);
      return revoked === 1 ? res.status(200).json({ status: 'editing' })
        : res.status(409).json({ error: 'DRAFT_REVIEW_REQUIRED' });
    }
    const submissions = {
      get: () => kv('GET', claimKey),
      claim: async () => (await kv('EVAL',
        "if redis.call('GET', KEYS[1]) ~= ARGV[1] or redis.call('GET', KEYS[2]) then return 0 end redis.call('SET', KEYS[2], ARGV[1]); return 1",
        '2', key(id) + ':review', claimKey, revision)) === 1
    };
    return res.status(200).json(await sendReviewedDraft({ mailbox, draftId: id, approvedRevision: revision, graph, submissions }));
  } catch (error) {
    const code = ['MAIL_PERMISSION_REQUIRED', 'PERSONAL_MAILBOX_REQUIRED', 'DRAFT_REVIEW_REQUIRED'].includes(error.message)
      ? error.message : 'OUTLOOK_COMPOSE_UNAVAILABLE';
    return res.status(code === 'DRAFT_REVIEW_REQUIRED' ? 409 : code === 'OUTLOOK_COMPOSE_UNAVAILABLE' ? 502 : 403).json({ error: code });
  }
};
