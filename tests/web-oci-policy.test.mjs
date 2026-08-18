import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  access,
  copyFile,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const fixtureCommit = 'a'.repeat(40);
const fixtureTree = 'b'.repeat(40);
const wrongCommit = 'c'.repeat(40);
const wrongTree = 'd'.repeat(40);
const expectedRuntimeEnv = [
  'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
  'SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt',
  'NODE_ENV=production',
  'PORT=8080',
  'DOTENV_CONFIG_PATH=/run/secrets/mkd-web.env',
];

function expectedLabels(overrides = {}) {
  return {
    'org.opencontainers.image.title': 'mkd-customer-ops-web',
    'org.opencontainers.image.version': '2.1.8-customer.1',
    'org.opencontainers.image.revision': fixtureCommit,
    'com.leo.mkd.source-tree': fixtureTree,
    ...overrides,
  };
}

async function mustRead(relativePath) {
  const absolutePath = path.join(root, relativePath);
  await access(absolutePath);
  return readFile(absolutePath, 'utf8');
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

async function writeOciFixture(
  root,
  layerContent,
  configOverrides = {},
  appLinkType,
) {
  const ociRoot = path.join(root, 'oci');
  const blobsRoot = path.join(ociRoot, 'blobs', 'sha256');
  const layerRoot = path.join(root, 'layer');
  await mkdir(path.join(layerRoot, 'app', 'dist'), { recursive: true });
  await mkdir(blobsRoot, { recursive: true });
  await writeFile(
    path.join(layerRoot, 'app', 'dist', 'index.cjs'),
    layerContent,
  );
  if (appLinkType === 'symlink') {
    await symlink(
      'index.cjs',
      path.join(layerRoot, 'app', 'dist', 'linked-index.cjs'),
    );
  } else if (appLinkType === 'hardlink') {
    await link(
      path.join(layerRoot, 'app', 'dist', 'index.cjs'),
      path.join(layerRoot, 'app', 'dist', 'linked-index.cjs'),
    );
  }

  const layerPath = path.join(root, 'layer.tar');
  execFileSync('tar', ['-cf', layerPath, '-C', layerRoot, '.']);
  const layerBytes = await readFile(layerPath);
  const layerDigest = sha256(layerBytes);
  await copyFile(layerPath, path.join(blobsRoot, layerDigest));

  const configBytes = Buffer.from(JSON.stringify({
    architecture: 'amd64',
    os: 'linux',
    config: {
      User: '65532:65532',
      Entrypoint: ['/nodejs/bin/node'],
      Cmd: ['dist/index.cjs'],
      ArgsEscaped: true,
      Env: expectedRuntimeEnv,
      ExposedPorts: { '8080/tcp': {} },
      Labels: expectedLabels(),
      StopSignal: 'SIGTERM',
      WorkingDir: '/app',
      ...configOverrides,
    },
  }));
  const configDigest = sha256(configBytes);
  await writeFile(path.join(blobsRoot, configDigest), configBytes);

  const manifestBytes = Buffer.from(JSON.stringify({
    schemaVersion: 2,
    config: {
      mediaType: 'application/vnd.oci.image.config.v1+json',
      digest: `sha256:${configDigest}`,
      size: configBytes.length,
    },
    layers: [{
      mediaType: 'application/vnd.oci.image.layer.v1.tar',
      digest: `sha256:${layerDigest}`,
      size: layerBytes.length,
    }],
  }));
  const manifestDigest = sha256(manifestBytes);
  await writeFile(path.join(blobsRoot, manifestDigest), manifestBytes);
  await writeFile(
    path.join(ociRoot, 'index.json'),
    JSON.stringify({
      schemaVersion: 2,
      manifests: [{
        mediaType: 'application/vnd.oci.image.manifest.v1+json',
        digest: `sha256:${manifestDigest}`,
        size: manifestBytes.length,
      }],
    }),
  );
  await writeFile(
    path.join(ociRoot, 'oci-layout'),
    JSON.stringify({ imageLayoutVersion: '1.0.0' }),
  );

  const archivePath = path.join(root, 'mkd-web-linux-amd64.oci.tar');
  execFileSync('tar', ['-cf', archivePath, '-C', ociRoot, '.']);
  const archiveBytes = await readFile(archivePath);
  const sumsPath = path.join(root, 'SHA256SUMS');
  await writeFile(
    sumsPath,
    `${sha256(archiveBytes)}  ${path.basename(archivePath)}\n`,
  );
  return { archivePath, sumsPath };
}

function missingVerifierTools() {
  return ['grep', 'jq', 'shasum', 'strings', 'tar']
    .filter((command) => spawnSync(
      'sh',
      ['-c', `command -v ${command} >/dev/null 2>&1`],
      { encoding: 'utf8' },
    ).status !== 0);
}

function runVerifier(archivePath, sumsPath, expectedCommit, expectedTree) {
  const verifier = path.join(root, 'scripts', 'verify-web-oci.sh');
  return spawnSync(
    'bash',
    [
      verifier,
      archivePath,
      'linux/amd64',
      sumsPath,
      expectedCommit,
      expectedTree,
    ],
    { encoding: 'utf8' },
  );
}

async function verifyFixture(context, {
  layerContent = 'console.log("customer Web runtime");\n',
  configOverrides = {},
  expectedCommit = fixtureCommit,
  expectedTree = fixtureTree,
  appLinkType,
} = {}) {
  const missingHostTools = missingVerifierTools();
  if (missingHostTools.length > 0) {
    context.skip(`host release tools unavailable: ${missingHostTools.join(', ')}`);
    return undefined;
  }
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'mkd-web-oci-test-'));
  context.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  const { archivePath, sumsPath } = await writeOciFixture(
    fixtureRoot,
    layerContent,
    configOverrides,
    appLinkType,
  );
  return runVerifier(archivePath, sumsPath, expectedCommit, expectedTree);
}

test('Web OCI uses pinned build and distroless runtime images', async () => {
  const containerfile = await mustRead('container/web/Containerfile');
  const fromLines = containerfile
    .split(/\r?\n/u)
    .filter((line) => /^FROM\s+/u.test(line));

  assert.equal(fromLines.length, 2);
  assert.match(
    containerfile,
    /^ARG NODE_BUILD_IMAGE=node:22-bookworm-slim@sha256:[0-9a-f]{64}$/mu,
  );
  assert.match(
    containerfile,
    /^ARG NODE_RUNTIME_IMAGE=gcr\.io\/distroless\/nodejs22-debian13:nonroot@sha256:[0-9a-f]{64}$/mu,
  );
  assert.equal(fromLines[0], 'FROM ${NODE_BUILD_IMAGE} AS build');
  assert.equal(fromLines[1], 'FROM ${NODE_RUNTIME_IMAGE}');
});

test('Web OCI builds a tested immutable commit and copies only runtime assets', async () => {
  const containerfile = await mustRead('container/web/Containerfile');
  const rootPackage = JSON.parse(await mustRead('package.json'));
  const webPackage = JSON.parse(await mustRead('apps/web-admin/package.json'));
  const runtimePackage = JSON.parse(
    await mustRead('container/web/runtime/package.json'),
  );

  for (const marker of [
    'ARG WEB_COMMIT_SHA',
    'ARG SOURCE_DATE_EPOCH',
    'npm ci --ignore-scripts',
    'npm run test:container',
    'npm run check --prefix apps/web-admin',
    'npm run test:customer --prefix apps/web-admin',
    'npm run build --prefix apps/web-admin',
    'container/web/runtime/package-lock.json',
    'npm ci --omit=dev --ignore-scripts --prefix /runtime',
    'rm -rf /runtime/node_modules/.bin',
    'find /runtime/node_modules -type f',
    'USER 65532:65532',
    'ENV NODE_ENV=production',
    'ENV PORT=8080',
    'COPY --from=build --chown=65532:65532 /src/apps/web-admin/dist ./dist',
    'COPY --from=build --chown=65532:65532 /runtime/node_modules ./node_modules',
    'CMD ["dist/index.cjs"]',
  ]) {
    assert.equal(containerfile.includes(marker), true, `missing ${marker}`);
  }

  const runtimeStage = containerfile.split(/\nFROM\s+/u).at(-1) ?? '';
  assert.doesNotMatch(runtimeStage, /COPY\s+(?:--[^\s]+\s+)*\.\s+/u);
  assert.doesNotMatch(
    runtimeStage,
    /COPY[^\n]+\/(?:server|client|shared|tests|script)(?:\s|\/)/u,
  );
  assert.doesNotMatch(runtimeStage, /(?:npm|npx|apt-get|apk)\s/u);
  assert.deepEqual(
    Object.keys(webPackage.dependencies).filter((name) => name.startsWith('@types/')),
    [],
    'type-only packages must stay out of the runtime dependency graph',
  );
  assert.deepEqual(Object.keys(runtimePackage.dependencies).sort(), [
    'bcryptjs',
    'connect-pg-simple',
    'dotenv',
    'express',
    'express-session',
    'pg',
    'zod',
  ]);
  assert.equal(
    rootPackage.scripts['test:container'],
    'node --test tests/delivery-boundary.test.mjs tests/web-oci-policy.test.mjs',
  );
});

test('Web OCI build identity uses the source commit timestamp', async () => {
  const containerfile = await mustRead('container/web/Containerfile');
  const build = await mustRead('apps/web-admin/script/build.ts');

  assert.match(containerfile, /SOURCE_DATE_EPOCH/u);
  assert.match(build, /process\.env\.SOURCE_DATE_EPOCH/u);
  assert.match(build, /sourceDateEpoch/u);
  assert.match(build, /process\.env\.APP_BRANCH/u);
});

test('Web OCI build binds the checked-out commit and tree into image labels', async () => {
  const containerfile = await mustRead('container/web/Containerfile');
  const script = await mustRead('scripts/build-web-oci.sh');

  assert.match(containerfile, /^ARG WEB_SOURCE_TREE$/mu);
  assert.match(
    containerfile,
    /com\.leo\.mkd\.source-tree="\$\{WEB_SOURCE_TREE\}"/u,
  );
  assert.match(script, /rev-parse HEAD/u);
  assert.match(script, /rev-parse 'HEAD\^\{tree\}'/u);
  assert.match(script, /web_source_tree=\$\{WEB_SOURCE_TREE:-\}/u);
  assert.equal(
    script.match(/\^\[0-9a-f\]\{40\}\$/gu)?.length,
    2,
    'commit and tree must both require exact lowercase 40-character hashes',
  );
  assert.match(
    script,
    /--build-arg "WEB_SOURCE_TREE=\$\{snapshot_tree\}"/u,
  );
  assert.match(
    script,
    /verify-web-oci\.sh"[\s\S]+"\$\{snapshot_commit\}"[\s\S]+"\$\{snapshot_tree\}"/u,
  );
});

test('Web OCI build freezes the verified commit tree into a private context', async () => {
  const script = await mustRead('scripts/build-web-oci.sh');
  const buildArchive = script.slice(
    script.indexOf('build_archive()'),
    script.indexOf('build_archive linux/amd64'),
  );

  assert.match(script, /mktemp -d/u);
  assert.match(script, /chmod 700 "\$\{temporary_root\}"/u);
  assert.match(script, /git -C "\$\{repo_root\}" ls-tree -r -z/u);
  assert.match(
    script,
    /git -C "\$\{repo_root\}" archive --format=tar --output="\$\{source_archive\}" "\$\{actual_web_commit\}"/u,
  );
  assert.match(script, /git get-tar-commit-id/u);
  assert.match(script, /unsupported Git tree entry/u);
  assert.match(script, /unsafe Web OCI snapshot member/u);
  assert.match(
    script,
    /tar -xf "\$\{source_archive\}" -C "\$\{build_context\}"/u,
  );
  assert.match(script, /chmod -R a-w "\$\{build_context\}"/u);
  assert.match(script, /snapshot_digest/u);
  assert.match(script, /trap cleanup/u);
  assert.equal(
    buildArchive.match(/verify_snapshot/gu)?.length,
    2,
    'each platform build must verify the frozen snapshot before and after use',
  );
  assert.doesNotMatch(buildArchive, /verify_source_identity/u);
  assert.match(
    buildArchive,
    /--build-arg "WEB_COMMIT_SHA=\$\{snapshot_commit\}"/u,
  );
  assert.match(
    buildArchive,
    /--build-arg "WEB_SOURCE_TREE=\$\{snapshot_tree\}"/u,
  );
  assert.match(
    buildArchive,
    /--file "\$\{build_context\}\/container\/web\/Containerfile"/u,
  );
  assert.match(buildArchive, /\n    "\$\{build_context\}"/u);
  assert.doesNotMatch(buildArchive, /"\$\{repo_root\}"/u);
});

test('Web OCI Containerfile defines the exact runtime config contract', async () => {
  const containerfile = await mustRead('container/web/Containerfile');

  assert.match(containerfile, /^STOPSIGNAL SIGTERM$/mu);
  assert.match(containerfile, /^EXPOSE 8080\/tcp$/mu);
  assert.doesNotMatch(containerfile, /org\.opencontainers\.image\.created/u);
});

test('Web OCI public runtime contract enforces least privilege', async () => {
  const contract = JSON.parse(await mustRead('container/web/runtime-contract.json'));

  assert.deepEqual(contract, {
    schema: 'mkd-web-runtime/v1',
    container_port: 8080,
    user: '65532:65532',
    read_only_root: true,
    cap_drop: ['ALL'],
    security_opt: ['no-new-privileges'],
    tmpfs: ['/tmp:rw,noexec,nosuid,nodev,size=16m,mode=1777'],
    readonly_config_mount: '/run/secrets/mkd-web.env',
    socket_mount: '/run/mkd-core',
    health_path: '/api/health',
    version_path: '/api/version',
  });
});

test('Web OCI build emits separate archives for both customer architectures', async () => {
  const script = await mustRead('scripts/build-web-oci.sh');

  assert.match(script, /linux\/amd64/u);
  assert.match(script, /linux\/arm64/u);
  assert.match(script, /WEB_COMMIT_SHA/u);
  assert.match(script, /SOURCE_DATE_EPOCH/u);
  assert.match(script, /NODE_BUILD_IMAGE/u);
  assert.match(script, /NODE_RUNTIME_IMAGE/u);
  assert.match(script, /\^\[0-9a-f\]\{40\}\$/u);
  assert.match(script, /type=oci/u);
  assert.match(script, /mkd-web-linux-amd64\.oci\.tar/u);
  assert.match(script, /mkd-web-linux-arm64\.oci\.tar/u);
  assert.match(script, /SHA256SUMS/u);
  assert.match(script, /npm test/u);
  assert.match(script, /verify-git-history\.sh/u);
});

test('Web OCI verifier and build context exclusions are present', async () => {
  const verifier = await mustRead('scripts/verify-web-oci.sh');
  const dockerignore = await mustRead('.dockerignore');

  for (const marker of [
    'runtime-contract.json',
    'index.json',
    'manifest',
    'config',
    '65532:65532',
    'SHA256SUMS',
  ]) {
    assert.equal(verifier.includes(marker), true, `verifier missing ${marker}`);
  }
  for (const excluded of [
    '.git',
    'node_modules',
    '**/node_modules',
    'dist',
    '**/dist',
    '.env',
    '**/.env*',
    '!apps/web-admin/.env.example',
    '*.key',
    '*.pem',
    '*.map',
    '**/*.map',
    'docs',
    'internal',
  ]) {
    assert.equal(
      dockerignore.split(/\r?\n/u).includes(excluded),
      true,
      `.dockerignore missing ${excluded}`,
    );
  }
});

test('Web OCI verifier rejects protected plaintext inside an allowed layer path', async (context) => {
  const result = await verifyFixture(context, {
    layerContent: `const protectedRules = "${['SOP', 'V3', 'MATRIX'].join('_')}";\n`,
  });
  if (!result) return;

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /forbidden Web OCI layer content/u);
});

test('Web OCI verifier accepts exact commit and tree labels', async (context) => {
  const result = await verifyFixture(context);
  if (!result) return;

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Web OCI verified/u);
  assert.match(result.stdout, new RegExp(`revision=${fixtureCommit}`, 'u'));
  assert.match(result.stdout, new RegExp(`source-tree=${fixtureTree}`, 'u'));
});

test('Web OCI verifier rejects a wrong revision label', async (context) => {
  const result = await verifyFixture(context, {
    configOverrides: { Labels: expectedLabels({
      'org.opencontainers.image.revision': wrongCommit,
    }) },
  });
  if (!result) return;

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /revision label does not match/u);
});

test('Web OCI verifier rejects a wrong source-tree label', async (context) => {
  const result = await verifyFixture(context, {
    configOverrides: {
      Labels: expectedLabels({ 'com.leo.mkd.source-tree': wrongTree }),
    },
  });
  if (!result) return;

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /source-tree label does not match/u);
});

test('Web OCI verifier rejects a missing source-tree label', async (context) => {
  const labels = expectedLabels();
  delete labels['com.leo.mkd.source-tree'];
  const result = await verifyFixture(context, {
    configOverrides: { Labels: labels },
  });
  if (!result) return;

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /source-tree label does not match/u);
});

test('Web OCI verifier rejects a malformed expected commit', async (context) => {
  const result = await verifyFixture(context, {
    expectedCommit: fixtureCommit.toUpperCase(),
  });
  if (!result) return;

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /expected commit must be/u);
});

test('Web OCI verifier rejects a malformed expected tree', async (context) => {
  const result = await verifyFixture(context, {
    expectedTree: fixtureTree.slice(1),
  });
  if (!result) return;

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /expected tree must be/u);
});

test('Web OCI verifier rejects a missing stop signal', async (context) => {
  const result = await verifyFixture(context, {
    configOverrides: { StopSignal: undefined },
  });
  if (!result) return;

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /runtime config contract does not match/u);
});

test('Web OCI verifier rejects a wrong stop signal', async (context) => {
  const result = await verifyFixture(context, {
    configOverrides: { StopSignal: 'SIGKILL' },
  });
  if (!result) return;

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /runtime config contract does not match/u);
});

test('Web OCI verifier rejects a missing working directory', async (context) => {
  const result = await verifyFixture(context, {
    configOverrides: { WorkingDir: undefined },
  });
  if (!result) return;

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /runtime config contract does not match/u);
});

test('Web OCI verifier rejects a wrong working directory', async (context) => {
  const result = await verifyFixture(context, {
    configOverrides: { WorkingDir: '/tmp' },
  });
  if (!result) return;

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /runtime config contract does not match/u);
});

test('Web OCI verifier rejects a non-exact environment', async (context) => {
  const result = await verifyFixture(context, {
    configOverrides: { Env: [...expectedRuntimeEnv, 'DEBUG=true'] },
  });
  if (!result) return;

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /runtime config contract does not match/u);
});

test('Web OCI verifier rejects non-exact labels', async (context) => {
  const result = await verifyFixture(context, {
    configOverrides: { Labels: expectedLabels({
      'org.opencontainers.image.created': '1755475200',
    }) },
  });
  if (!result) return;

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /image labels do not match/u);
});

test('Web OCI verifier rejects non-exact exposed ports', async (context) => {
  const result = await verifyFixture(context, {
    configOverrides: {
      ExposedPorts: { '8080/tcp': {}, '9090/tcp': {} },
    },
  });
  if (!result) return;

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /runtime config contract does not match/u);
});

test('Web OCI verifier rejects ArgsEscaped other than true', async (context) => {
  const result = await verifyFixture(context, {
    configOverrides: { ArgsEscaped: false },
  });
  if (!result) return;

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /runtime config contract does not match/u);
});

test('Web OCI verifier rejects a symlink under app', async (context) => {
  const result = await verifyFixture(context, { appLinkType: 'symlink' });
  if (!result) return;

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /forbidden Web OCI app link/u);
});

test('Web OCI verifier rejects a hardlink under app', async (context) => {
  const result = await verifyFixture(context, { appLinkType: 'hardlink' });
  if (!result) return;

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /forbidden Web OCI app link/u);
});
