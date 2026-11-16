'use strict';
const { discover } = require('./mail-discovery.cjs');
const { candidates } = require('../../mail-attention.js');

async function includeImportantFolder(inbox, prior, folder, readPage) {
 const at = new Date().toISOString();
 try {
  const first = await readPage(null);
  const previous = {provenance: [{collector: folder, discovery: prior}]};
  const page = await discover(previous, folder, first, readPage, at);
  const eligible = new Set(candidates(page.messages).map(item => item.id));
  const extras = page.messages.filter(item => eligible.has(item.id)).map(item => ({...item, sourceFolder: folder}));
  return {...inbox, messages: [...new Map([...extras, ...inbox.messages].map(item => [item.id, item])).values()],
   discovery: {...inbox.discovery, importantFolder: page.discovery, failed: inbox.discovery.failed || page.discovery.failed}};
 } catch {
  return {...inbox, discovery: {...inbox.discovery, failed: true, importantFolder: {...prior, failed: true}}};
 }
}
module.exports = {includeImportantFolder};
