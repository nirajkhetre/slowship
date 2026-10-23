// INERT TEST FIXTURE: shaped like the file the ChainDrop worm plants, never run.
// The blob is base64 of a plain English sentence: decoding it gives words, not code.
const blob = 'VGhpcyBzdHJpbmcgaXMgYW4gaW5lcnQgdGVzdCBmaXh0dXJlIGZvciBzbG93c2hpcC4gSXQgb25seSBsb29rcyBsaWtlIGFuIGVuY29kZWQgcGF5bG9hZCBzbyB0aGUgcmVhZGVyIGhhcyBzb21ldGhpbmcgdG8gZmluZDsgZGVjb2RpbmcgaXQgZ2l2ZXMgdGhlc2Ugd29yZHMgYmFjaywgYW5kIG5vdGhpbmcgaW4gaXQgaXMgY29kZS4=';

export default function start() {
  return new Function(Buffer.from(blob, 'base64').toString('utf8'));
}
