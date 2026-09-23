const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const workflow = fs.readFileSync(
  path.join(root, ".github", "workflows", "protected-preview-security.yml"),
  "utf8"
);
const runner = fs.readFileSync(path.join(root, "tests", "deployed-security.test.js"), "utf8");
const instructions = fs.readFileSync(
  path.join(root, "docs", "DEPLOYED-SECURITY-VERIFICATION.md"),
  "utf8"
);

test("ordinary pull-request CI cannot start the secret-bearing Preview probe", () => {
  assert.match(workflow, /^name: James Protected Preview Security Gate$/m);
  assert.match(workflow, /RUN_ATTEMPT: \$\{\{ github\.run_attempt \}\}/);
  assert.match(workflow, /if \[\[ "\$RUN_ATTEMPT" == "1" \]\]/);
  assert.match(workflow, /echo "authorized=false" >> "\$GITHUB_OUTPUT"/);
  assert.match(workflow, /if: needs\.manual-authorization\.outputs\.authorized == 'true'/);
  assert.match(workflow, /TRIGGERING_ACTOR: \$\{\{ github\.triggering_actor \}\}/);
  assert.match(workflow, /"\$TRIGGERING_ACTOR" != "GetJames001"/);
  assert.doesNotMatch(workflow, /workflow_dispatch|pull_request_target/);
});

test("manual gate pins the repository, PR, head, base, branch, and both Preview hosts", () => {
  assert.match(workflow, /GetJames001\/-james-app/);
  assert.match(workflow, /"\$PR_NUMBER" != "9"/);
  assert.match(workflow, /security-single-user-auth/);
  assert.match(workflow, /4da3dec2f6d03e8ae368289f926b521c96922c1e/);
  assert.match(workflow, /current_head.*EVENT_HEAD_SHA/);
  assert.match(workflow, /deployments\?sha=\$EVENT_HEAD_SHA/);
  assert.match(workflow, /\.environment_url/);
  assert.match(workflow, /james-app-git-security-single-user-auth-james-cb7a\.vercel\.app/);
  assert.match(workflow, /immutable_url.*branch_url/);
  assert.match(workflow, /ref: \$\{\{ needs\.manual-authorization\.outputs\.head_sha \}\}/);
  assert.match(workflow, /persist-credentials: false/);
});

test("automation secret is confined to the manually authorized probe step", () => {
  assert.match(
    workflow,
    /VERCEL_AUTOMATION_BYPASS_SECRET: \$\{\{ secrets\.JAMES_VERCEL_AUTOMATION_BYPASS \}\}/
  );
  assert.match(workflow, /::add-mask::\$VERCEL_AUTOMATION_BYPASS_SECRET/);
  assert.match(workflow, /set \+x/);
  assert.doesNotMatch(workflow, /upload-artifact|--debug|ACTIONS_STEP_DEBUG/);
  assert.match(runner, /x-vercel-protection-bypass/);
  assert.match(runner, /mode: 0o600/);
  assert.match(runner, /`@\$\{bypassHeaderFile\}`/);
  assert.doesNotMatch(runner, /--header",\s*`x-vercel-protection-bypass:/);
});

test("operator instructions are browser-only and include prompt revocation", () => {
  assert.match(instructions, /browser-only/i);
  assert.match(instructions, /JAMES_VERCEL_AUTOMATION_BYPASS/);
  assert.match(instructions, /Re-run all jobs/);
  assert.match(instructions, /Leave \*\*Enable debug logging\*\* unchecked/);
  assert.match(instructions, /delete `JAMES_VERCEL_AUTOMATION_BYPASS`/);
  assert.match(instructions, /revoke\/delete `GitHub Actions — James PR #9 review`/);
  assert.doesNotMatch(instructions, /npm install --global|vercel login|git clone/i);
});
