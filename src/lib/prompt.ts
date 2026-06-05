/**
 * Portable synchronous line reader — works under Node and Bun, for an interactive TTY and
 * for piped stdin alike.
 *
 * Why not just `prompt()`: that global exists in Bun but NOT in Node. And Node's
 * readline/promises stalls on a pipe under Bun. Reading file descriptor 0 directly sidesteps
 * both runtimes' quirks. Bytes are accumulated and decoded as UTF-8 only at the end, so
 * non-ASCII input (e.g. Polish characters) is preserved.
 */
import { readSync } from 'node:fs';

/** Print `text` and block until the user types a line; returns it trimmed of the newline. */
export function question(text: string): string {
  process.stdout.write(text.endsWith(' ') ? text : text + ' ');
  const bytes: number[] = [];
  const buf = Buffer.alloc(1);
  while (true) {
    let n = 0;
    try {
      n = readSync(0, buf, 0, 1, null);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'EAGAIN') continue;   // stdin momentarily not ready — retry
      if (code === 'EOF') break;         // some platforms surface EOF as an error
      throw e;
    }
    if (n === 0) break;                  // EOF (e.g. end of a pipe)
    const b = buf[0]!;
    if (b === 0x0a) break;               // \n — end of line
    if (b === 0x0d) continue;            // \r — ignore (CRLF)
    bytes.push(b);
  }
  return Buffer.from(bytes).toString('utf8');
}
