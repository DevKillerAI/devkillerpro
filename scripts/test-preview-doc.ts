import { pilotPreviewDocument } from '@/lib/workspace/pilotPreview';

const doc = pilotPreviewDocument([{ path: 'assets/app.js', content: 'console.log("hello");' }], 'run-12345678', 'nonce-1234567890123456', {});
console.log('Doc preview:\n', doc.slice(0, 500));

// Let's extract the first <script>
const script1 = doc.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1];
console.log('Script 1:\n', script1);

try {
  if (script1) {
    new Function(script1);
    console.log('Script 1 syntax is VALID!');
  }
} catch (e) {
  console.error('Script 1 syntax ERROR:', e);
}
