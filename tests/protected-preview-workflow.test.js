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
  assert.match(workflow, /"\$PR_NUMBER" != "\$APPROVED_PR"/);
  assert.match(workflow, /"\$EVENT_HEAD_SHA" != "\$APPROVED_HEAD"/);
  assert.match(workflow, /vars\.JAMES_SECURITY_APPROVED_HEAD/);
  assert.match(workflow, /review\/customer-activity-save-20261021/);
  assert.match(workflow, /5953549b64558a2cb6e9b6f9e86acf9e295642b8/);
  assert.match(workflow, /current_head.*EVENT_HEAD_SHA/);
  assert.match(workflow, /deployments\?sha=\$EVENT_HEAD_SHA/);
  assert.match(workflow, /\.environment_url/);
  assert.match(workflow, /james-app-git-review-customer-activity-save-20261021-james-cb7a\.vercel\.app/);
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
  assert.match(instructions, /revoke\/delete `GitHub Actions — James release review`/);
  assert.doesNotMatch(instructions, /npm install --global|vercel login|git clone/i);
});

test("authorization fails closed before metadata access for missing approval, wrong revision or actor", () => {
  const { spawnSync } = require("node:child_process");
  const gate = workflow.split('        run: |\n')[1].split('\n  protected-preview-security:')[0]
    .split('\n').map(line => line.startsWith('          ') ? line.slice(10) : line).join('\n');
  const base = { PATH: process.env.PATH, GITHUB_OUTPUT: '/dev/null', RUN_ATTEMPT: '2',
    GITHUB_REPOSITORY: 'GetJames001/-james-app', PR_NUMBER: '40', APPROVED_PR: '40',
    EVENT_HEAD_SHA: 'a'.repeat(40), APPROVED_HEAD: 'a'.repeat(40),
    ORIGINAL_ACTOR: 'GetJames001', TRIGGERING_ACTOR: 'GetJames001',
    EVENT_HEAD_REF: 'review/customer-activity-save-20261021',
    EVENT_HEAD_REPOSITORY: 'GetJames001/-james-app',
    EVENT_BASE_SHA: '5953549b64558a2cb6e9b6f9e86acf9e295642b8' };
  for (const change of [{ APPROVED_PR: '' }, { APPROVED_HEAD: '' },
    { APPROVED_HEAD: 'b'.repeat(40) }, { PR_NUMBER: '9' },
    { TRIGGERING_ACTOR: 'someone-else' }, { EVENT_HEAD_REF: 'main' },
    { EVENT_BASE_SHA: 'b'.repeat(40) }, { EVENT_HEAD_REPOSITORY: 'fork/repo' }]) {
    const result = spawnSync('bash', ['-c', gate], { env: { ...base, ...change }, encoding: 'utf8' });
    assert.equal(result.status, 1, JSON.stringify(change));
    assert.match(result.stdout, /::error::/);
    assert.doesNotMatch(result.stderr, /gh:|command not found/);
  }
  const ordinary = spawnSync('bash', ['-c', gate], { env: { ...base, RUN_ATTEMPT: '1', APPROVED_HEAD: '' }, encoding: 'utf8' });
  assert.equal(ordinary.status, 0);
  assert.match(ordinary.stdout, /intentionally skipped/);
});
