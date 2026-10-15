'use strict';
const crypto=require('node:crypto');
// RFC 8410 Ed25519 PKCS#8 seed wrapper; cryptographic operations use Node/OpenSSL.
function bridgeKeys(secret){
 if(typeof secret!=='string'||Buffer.byteLength(secret,'utf8')<32)throw Error('Bridge not configured');
 const seed=crypto.createHash('sha256').update('james-wardrobe-signing-seed-v2\0').update(secret,'utf8').digest();
 const privateKey=crypto.createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),seed]),format:'der',type:'pkcs8'});
 const jwk=crypto.createPublicKey(privateKey).export({format:'jwk'});
 return {privateKey,publicKey:Buffer.from(jwk.x,'base64url').toString('hex')};
}
module.exports={bridgeKeys};
