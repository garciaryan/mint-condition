import { hashPassword } from "../lib/password.ts";
import { ask, closePrompt } from "./prompt.ts";

const first = await ask("Password (min 12 characters): ", { hidden: true });
const second = await ask("Repeat password: ", { hidden: true });
closePrompt();

if (first !== second) {
  console.error("Passwords do not match.");
  process.exit(1);
}
if (first.length < 12) {
  console.error("Password must be at least 12 characters.");
  process.exit(1);
}
console.log(hashPassword(first));
console.log("Or skip hashing: set APP_PASSWORD instead (see README).");
