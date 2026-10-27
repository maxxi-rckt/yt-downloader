// Talks to the helper binary over the Native Messaging protocol and prints every reply.
// Usage: node tools/test-helper.js <helper-binary> '<json msg>' ['<json msg>' ...]
// Exits non-zero if any request ends in an error.
const { spawn } = require('child_process');
const [bin, ...msgs] = process.argv.slice(2);
const host = spawn(bin, ['chrome-extension://geplnkbnclcjomicgikpicndapejlgih/']);
const final = ['pong', 'info', 'done', 'error', 'cancelled', 'updated', 'folder'];
let buf = Buffer.alloc(0), waiting = msgs.length, failed = false;
host.stdout.on('data', (d) => {
  buf = Buffer.concat([buf, d]);
  while (buf.length >= 4 && buf.length >= 4 + buf.readUInt32LE(0)) {
    const len = buf.readUInt32LE(0);
    const msg = JSON.parse(buf.subarray(4, 4 + len));
    buf = buf.subarray(4 + len);
    if (msg.type !== 'progress') console.log(JSON.stringify(msg));
    if (msg.type === 'error') failed = true;
    if (final.includes(msg.type) && --waiting <= 0) host.stdin.end();
  }
});
host.stderr.pipe(process.stderr);
host.on('close', () => process.exit(failed || waiting > 0 ? 1 : 0));
for (const a of msgs) {
  const body = Buffer.from(a), h = Buffer.alloc(4);
  h.writeUInt32LE(body.length);
  host.stdin.write(Buffer.concat([h, body]));
}
