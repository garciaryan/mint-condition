// Terminal prompts for the setup scripts. Hidden answers are typed without echo (readline writes to a muted stream).
import { createInterface } from "node:readline";
import type { Interface } from "node:readline";
import { Writable } from "node:stream";

let muted = false;
let rl: Interface | undefined;

const out = new Writable({
  write(chunk, _enc, cb) {
    if (!muted) process.stdout.write(chunk);
    cb();
  },
});

export function ask(question: string, opts: { hidden?: boolean } = {}): Promise<string> {
  rl ??= createInterface({ input: process.stdin, output: out, terminal: true });
  const r = rl;
  return new Promise((resolve) => {
    process.stdout.write(question);
    muted = !!opts.hidden;
    r.question("", (answer) => {
      if (muted) process.stdout.write("\n");
      muted = false;
      resolve(answer);
    });
  });
}

export function closePrompt(): void {
  rl?.close();
  rl = undefined;
}
