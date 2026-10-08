import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const wf = readFileSync(".github/workflows/fly-deploy.yml", "utf8");
const JOBS = ["check", "image", "canary", "release", "shops"];
/** One job's text, from its header to the next job's. */
function job(name: string): string {
  const start = wf.indexOf(`\n  ${name}:\n`);
  assert.ok(start >= 0, `job ${name} exists`);
  const next = JOBS.map((j) => wf.indexOf(`\n  ${j}:\n`, start + 1)).filter((i) => i > start);
  return wf.slice(start, next.length ? Math.min(...next) : undefined);
}

test("push runs share one queue that never cancels; PR runs are separate", () => {
  const top = wf.slice(0, wf.indexOf("\njobs:"));
  assert.match(top, /concurrency:\s*\n\s*group: \$\{\{ github\.event_name == 'push' && 'deploy' \|\| github\.ref \}\}\s*\n\s*cancel-in-progress: false/);
});

test("image builds once, checks the shop list, and pushes to GHCR", () => {
  const j = job("image");
  assert.match(j, /needs: check/);
  assert.match(j, /if: github\.event_name == 'push' && github\.repository == 'garciaryan\/mint-condition'/);
  assert.match(j, /packages: write/);
  assert.match(j, /fetch-depth: 0/);
  assert.match(j, /scripts\/next-version\.ts/);
  assert.match(j, /FLY_SHOP_APPS: \$\{\{ vars\.FLY_SHOP_APPS \}\}/);
  assert.match(j, /scripts\/shop-apps\.ts/);
  assert.match(j, /docker\/build-push-action/);
  assert.match(j, /APP_VERSION=/);
  assert.match(j, /ghcr\.io\/garciaryan\/mint-condition:/);
});

test("the canary deploys the image first", () => {
  const j = job("canary");
  assert.match(j, /needs: image/);
  assert.match(j, /flyctl deploy --image \$\{\{ needs\.image\.outputs\.image \}\}/);
});

test("the release is tagged only after the canary is live", () => {
  const j = job("release");
  assert.match(j, /needs: \[image, canary\]/);
  assert.match(j, /contents: write/);
  assert.match(j, /gh release create "\$TAG" --title "\$TAG" --prerelease --generate-notes --verify-tag/);
  assert.equal(wf.split("gh release create").length, 2, "no other job creates a release");
});

test("every shop deploys the same image after the canary, each with its own token", () => {
  const j = job("shops");
  assert.match(j, /needs: \[image, canary\]/);
  assert.match(j, /if: needs\.image\.outputs\.shops != '\[\]'/);
  assert.match(j, /fromJSON\(needs\.image\.outputs\.shops\)/);
  assert.match(j, /fail-fast: false/);
  assert.match(j, /secrets\[matrix\.shop\.token\]/);
  assert.match(j, /::error::/, "a missing token secret is named, not an opaque auth error");
  assert.match(j, /flyctl deploy --image \$\{\{ needs\.image\.outputs\.image \}\} -a \$\{\{ matrix\.shop\.app \}\}/);
});

test("nothing builds on Fly any more", () => {
  assert.doesNotMatch(wf, /--remote-only/);
});

test("a bad FLY_SHOP_APPS fails the image step (assigned first, so bash -e sees the script's exit)", () => {
  const j = job("image");
  assert.match(j, /shops=\$\(node --experimental-strip-types --no-warnings scripts\/shop-apps\.ts\)\n\s*echo "shops=\$shops" >> "\$GITHUB_OUTPUT"/);
  assert.doesNotMatch(j, /echo "shops=\$\(/);
});

test("the image is a plain manifest Fly can pull (no provenance attestation)", () => {
  assert.match(job("image"), /provenance: false/);
});

test("the shop runbook's first deploy is one machine next to its volume, before the workflow knows the shop", () => {
  const deploy = readFileSync("DEPLOY.md", "utf8");
  const add = deploy.slice(deploy.indexOf("### Add a shop"), deploy.indexOf("### Roll back one app"));
  assert.match(add, /fly deploy --image ghcr\.io\/garciaryan\/mint-condition:<latest tag> -a mc-groove --primary-region <same region> --ha=false/);
  const first = add.indexOf("fly deploy --image");
  assert.ok(first >= 0 && first < add.indexOf("gh secret set") && first < add.indexOf("gh variable set"), "first deploy comes before the shop is listed");
});

test("the image job claims its tag before building, so no number is ever built twice", () => {
  const j = job("image");
  assert.match(j, /contents: write/);
  const push = j.indexOf('git push origin "refs/tags/$tag"');
  assert.ok(push >= 0, "pushes the tag");
  assert.ok(j.indexOf('git tag "$tag"') < push);
  assert.ok(j.indexOf("scripts/shop-apps.ts") < push, "a bad shop list stops the run before a number is claimed");
  assert.ok(push < j.indexOf("docker/build-push-action"), "tag pushed before the image is built");
});
