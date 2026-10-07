import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Next also compiles instrumentation.ts for the edge runtime, with NEXT_RUNTIME replaced by "edge". In dev, webpack
// only drops a Node-only import when it sits inside `if (process.env.NEXT_RUNTIME === "nodejs") { ... }`; code after
// an early `return` is still compiled, and its node: imports break `npm run dev` (500 on every page).
test("instrumentation imports Node-only modules only inside the NEXT_RUNTIME === \"nodejs\" block", () => {
  const src = readFileSync("instrumentation.ts", "utf8");
  const start = src.indexOf('if (process.env.NEXT_RUNTIME === "nodejs") {');
  assert.ok(start >= 0, 'register() wraps its work in if (process.env.NEXT_RUNTIME === "nodejs") { ... }');
  let depth = 0;
  let end = -1;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) {
      end = i;
      break;
    }
  }
  const imports = [...src.matchAll(/import\(/g)].map((m) => m.index);
  assert.ok(imports.length > 0);
  for (const at of imports) assert.ok(at > start && at < end, `import() at ${at} is outside the nodejs block`);
});
