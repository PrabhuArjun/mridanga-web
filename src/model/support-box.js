// Pinned local service identity. The exchange does not trust a tunnel hostname
// with a student's plaintext, even if that hostname expires or changes hands.
const PUBLIC_KEY = 'BOAayorE3AJUYCATXcDGdus2ndYB8-OdPX2EIfbdco4qSgR6FJar4l-5P7zaUc2rLyvhrK8DDxGoejdBk-rZjpw';
const enc=new TextEncoder(),dec=new TextDecoder();
const info=enc.encode('mridanga-support-v1');
const b64=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const raw=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),ch=>ch.charCodeAt(0));
export async function wrapQuestion(question){
 const subtle=globalThis.crypto.subtle;
 const algo={name:'ECDH',namedCurve:'P-256'};
 const peer=await subtle.importKey('raw',raw(PUBLIC_KEY),algo,false,[]);
 const local=await subtle.generateKey(algo,true,['deriveBits']);
 const secret=await subtle.deriveBits({name:'ECDH',public:peer},local.privateKey,256);
 const key=await subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:new Uint8Array(32),info},
  await subtle.importKey('raw',secret,'HKDF',false,['deriveKey']),{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
 const algoFor=(iv,s)=>({name:'AES-GCM',iv,additionalData:enc.encode('mridanga-support-v1:'+s)});
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const sealed=await subtle.encrypt(algoFor(iv,'ask'),key,enc.encode(JSON.stringify({question})));
 const body=JSON.stringify({publicKey:b64(await subtle.exportKey('raw',local.publicKey)),iv:b64(iv),ciphertext:b64(sealed)});
 return {body,async open(v){
   if(typeof v?.iv!=='string'||v.iv.length!==16||typeof v?.ciphertext!=='string'||v.ciphertext.length>1024)throw Error('envelope');
   return JSON.parse(dec.decode(await subtle.decrypt(algoFor(raw(v.iv),'answer'),key,raw(v.ciphertext))));
 }};
}
