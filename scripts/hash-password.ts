import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { hashPassword } from "../lib/password.ts";

let muted = false;
const out = new Writable({
  write(chunk, _enc, cb) {
    if (!muted) process.stdout.write(chunk);
    cb();
  },
});
const rl = createInterface({ input: process.stdin, output: out, terminal: true });

function ask(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    muted = true;
    rl.question("", (answer) => {
      muted = false;
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

const first = await ask("Password (min 12 characters): ");
const second = await ask("Repeat password: ");
rl.close();

if (first !== second) {
  console.error("Passwords do not match.");
  process.exit(1);
}
if (first.length < 12) {
  console.error("Password must be at least 12 characters.");
  process.exit(1);
}
console.log(hashPassword(first));
console.log("Set SESSION_SECRET with: openssl rand -base64 32");
