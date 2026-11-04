const { personalMailbox } = require('./compose.js');

function createComposeGraph(accessToken, request = fetch) {
  async function graph(path, method = 'GET', body) {
    const response = await request('https://graph.microsoft.com/v1.0/me' + (path.startsWith('?') ? path : '/' + path), {
      method,
      headers: {
        Authorization: 'Bearer ' + accessToken,
        Prefer: 'IdType="ImmutableId", outlook.body-content-type="text"',
        'Content-Type': 'application/json'
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) {
      const error = Error([401, 403].includes(response.status) ? 'MAIL_PERMISSION_REQUIRED' : 'OUTLOOK_REQUEST_FAILED');
      error.status = response.status;
      throw error;
    }
    return [202, 204].includes(response.status) ? null : response.json();
  }

  const messagePath = id => 'messages/' + encodeURIComponent(id);
  const attachmentFields = '?$select=id,name,size&$top=100';

  return {
    async verifyMailbox() {
      const profile = await graph('?$select=mail,userPrincipalName');
      if ((profile.mail || profile.userPrincipalName || '').toLowerCase() !== personalMailbox) {
        throw Error('PERSONAL_MAILBOX_REQUIRED');
      }
      return personalMailbox;
    },
    listDrafts() {
      return graph('mailFolders/drafts/messages?$select=id,subject,lastModifiedDateTime&$orderby=lastModifiedDateTime%20desc&$top=50');
    },
    updateDraft(id, message) {
      return graph(messagePath(id), 'PATCH', message);
    },
    discardDraft(id) {
      return graph(messagePath(id), 'DELETE');
    },
    createDraft(message) {
      return graph('messages', 'POST', message);
    },
    addAttachment(id, file) {
      return graph(messagePath(id) + '/attachments', 'POST', {
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: file.name,
        contentType: file.contentType,
        contentBytes: file.contentBytes
      });
    },
    readAttachment(id, attachmentId) {
      return graph(messagePath(id) + '/attachments/' + encodeURIComponent(attachmentId));
    },
    async readDraft(id) {
      const draft = await graph(messagePath(id));
      const list = await graph(messagePath(id) + '/attachments' + attachmentFields);
      if (list['@odata.nextLink'] || !Array.isArray(list.value)) throw Error('ATTACHMENTS_NOT_VERIFIED');
      const checked = await graph(messagePath(id) + '?$select=changeKey');
      if (!draft.changeKey || draft.changeKey !== checked.changeKey) throw Error('DRAFT_REVIEW_REQUIRED');
      return { draft, attachments: list.value };
    },
    sendDraft(id) {
      return graph(messagePath(id) + '/send', 'POST');
    },
    async confirmSubmission(id) {
      try {
        const message = await graph(messagePath(id) + '?$select=isDraft,parentFolderId');
        const sent = await graph('mailFolders/sentitems?$select=id');
        if (message.isDraft === false && message.parentFolderId === sent.id) return { status: 'sent' };
      } catch {
        // Outlook may still be moving the message into Sent Items.
      }
      return { status: 'confirmation_pending' };
    }
  };
}

module.exports = { createComposeGraph };
