const { createHash } = require('node:crypto');

const personalMailbox = 'allproactive@hotmail.com';

function reviewDraft(mailbox, draft, attachments) {
  if (mailbox?.toLowerCase() !== personalMailbox) throw Error('PERSONAL_MAILBOX_REQUIRED');
  if (!draft?.id || !draft.isDraft || !draft.changeKey) throw Error('DRAFT_NOT_AVAILABLE');

  const addresses = recipients => (recipients || []).map(item => item.emailAddress.address);
  const from = draft.from?.emailAddress?.address || mailbox;
  if (from.toLowerCase() !== personalMailbox) throw Error('PERSONAL_MAILBOX_REQUIRED');

  const review = {
    from,
    to: addresses(draft.toRecipients),
    cc: addresses(draft.ccRecipients),
    bcc: addresses(draft.bccRecipients),
    subject: draft.subject || '',
    message: draft.body?.content || '',
    contentType: draft.body?.contentType,
    attachments: attachments.map(file => ({ id: file.id, name: file.name, size: file.size }))
  };
  const revision = createHash('sha256')
    .update(JSON.stringify([draft.id, draft.changeKey, review]))
    .digest('hex');
  return { ...review, revision };
}

async function sendReviewedDraft({ mailbox, draftId, approvedRevision, graph, submissions }) {
  // A durable claim must survive process termination and ambiguous Graph responses.
  const existing = await submissions.get(mailbox, draftId);
  if (existing) return graph.confirmSubmission(draftId);

  const { draft, attachments } = await graph.readDraft(draftId);
  const review = reviewDraft(mailbox, draft, attachments);
  if (review.revision !== approvedRevision) throw Error('DRAFT_REVIEW_REQUIRED');
  if (!await submissions.claim(mailbox, draftId, approvedRevision)) {
    return graph.confirmSubmission(draftId);
  }

  try {
    await graph.sendDraft(draftId);
  } catch {
    return { status: 'confirmation_pending' };
  }
  return graph.confirmSubmission(draftId).catch(() => ({ status: 'confirmation_pending' }));
}

module.exports = { personalMailbox, reviewDraft, sendReviewedDraft };
