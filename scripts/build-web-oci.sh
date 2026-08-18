#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
web_commit_sha=${WEB_COMMIT_SHA:-}
web_source_tree=${WEB_SOURCE_TREE:-}
output_dir=${WEB_OCI_OUTPUT_DIR:-"${repo_root}/dist/web-oci"}
docker_bin=${DOCKER_BIN:-docker}
node_build_digest=d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436
node_runtime_digest=939d6f1671529d230f50b563578e9b5d206af58f038b10ebd7e1233023d4e167
node_build_image=${NODE_BUILD_IMAGE:-"node:22-bookworm-slim@sha256:${node_build_digest}"}
node_runtime_image=${NODE_RUNTIME_IMAGE:-"gcr.io/distroless/nodejs22-debian13:nonroot@sha256:${node_runtime_digest}"}

require_allowed_reference() {
  local value=$1
  shift
  local allowed
  for allowed in "$@"; do
    [[ "${value}" == "${allowed}" ]] && return 0
  done
  printf 'unapproved pinned base image reference: %s\n' "${value}" >&2
  return 1
}

require_allowed_reference "${node_build_image}" \
  "node:22-bookworm-slim@sha256:${node_build_digest}" \
  "docker.m.daocloud.io/library/node:22-bookworm-slim@sha256:${node_build_digest}" \
  "dockerproxy.net/library/node:22-bookworm-slim@sha256:${node_build_digest}"
require_allowed_reference "${node_runtime_image}" \
  "gcr.io/distroless/nodejs22-debian13:nonroot@sha256:${node_runtime_digest}" \
  "gcr.m.daocloud.io/distroless/nodejs22-debian13:nonroot@sha256:${node_runtime_digest}"

if [[ ! "${web_commit_sha}" =~ ^[0-9a-f]{40}$ ]]; then
  printf 'WEB_COMMIT_SHA must be the exact 40-character lowercase commit SHA\n' >&2
  exit 64
fi
if [[ ! "${web_source_tree}" =~ ^[0-9a-f]{40}$ ]]; then
  printf 'WEB_SOURCE_TREE must be the exact 40-character lowercase source tree SHA\n' >&2
  exit 64
fi

actual_web_commit=
actual_web_source_tree=
temporary_parent=
temporary_root=
source_archive=
build_context=
source_archive_digest=
snapshot_commit=
snapshot_tree=
snapshot_digest=
verify_source_identity() {
  actual_web_commit=$(git -C "${repo_root}" rev-parse HEAD)
  actual_web_source_tree=$(git -C "${repo_root}" rev-parse 'HEAD^{tree}')
  if [[ "${actual_web_commit}" != "${web_commit_sha}" ]]; then
    printf 'WEB_COMMIT_SHA does not match the checked-out commit\n' >&2
    exit 65
  fi
  if [[ "${actual_web_source_tree}" != "${web_source_tree}" ]]; then
    printf 'WEB_SOURCE_TREE does not match the checked-out source tree\n' >&2
    exit 65
  fi
  if [[ -n "$(git -C "${repo_root}" status --porcelain --untracked-files=normal)" ]]; then
    printf 'Web OCI builds require a clean customer-delivery worktree\n' >&2
    exit 65
  fi
}

cleanup() {
  if [[ -z "${temporary_root}" || ! -d "${temporary_root}" ]]; then
    return 0
  fi
  case "${temporary_root}" in
    "${temporary_parent}"/mkd-web-build.*) ;;
    *)
      printf 'refusing to clean unexpected temporary path: %s\n' "${temporary_root}" >&2
      return 1
      ;;
  esac
  chmod -R u+w "${temporary_root}" 2>/dev/null || true
  rm -rf -- "${temporary_root}"
  temporary_root=
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

validate_snapshot_tree() {
  local entry
  local metadata
  local mode
  local object_type
  local source_path
  while IFS= read -r -d '' entry; do
    if [[ "${entry}" != *$'\t'* ]]; then
      printf 'invalid Git tree entry in Web OCI source snapshot\n' >&2
      exit 65
    fi
    metadata=${entry%%$'\t'*}
    source_path=${entry#*$'\t'}
    mode=${metadata%% *}
    metadata=${metadata#* }
    object_type=${metadata%% *}
    if [[ "${object_type}" != blob \
      || ( "${mode}" != 100644 && "${mode}" != 100755 ) ]]; then
      printf 'unsupported Git tree entry for Web OCI snapshot: %s\n' "${source_path}" >&2
      exit 65
    fi
    if [[ -z "${source_path}" \
      || "${source_path}" == /* \
      || "/${source_path}/" == *'/../'* \
      || "/${source_path}/" == *'/./'* \
      || "${source_path}" == *$'\n'* \
      || "${source_path}" == *$'\r'* ]]; then
      printf 'unsafe Git path in Web OCI snapshot: %s\n' "${source_path}" >&2
      exit 65
    fi
  done < <(git -C "${repo_root}" ls-tree -r -z "${actual_web_commit}")
}

calculate_snapshot_digest() {
  tar -cf - -C "${build_context}" . | shasum -a 256 | awk '{print $1}'
}

verify_snapshot() {
  local actual_archive_digest
  local actual_snapshot_digest
  if [[ "${snapshot_commit}" != "${web_commit_sha}" \
    || "${snapshot_tree}" != "${web_source_tree}" ]]; then
    printf 'Web OCI snapshot identity drift detected\n' >&2
    exit 65
  fi
  actual_archive_digest=$(shasum -a 256 "${source_archive}" | awk '{print $1}')
  actual_snapshot_digest=$(calculate_snapshot_digest)
  if [[ "${actual_archive_digest}" != "${source_archive_digest}" \
    || "${actual_snapshot_digest}" != "${snapshot_digest}" ]]; then
    printf 'Web OCI source snapshot content drift detected\n' >&2
    exit 65
  fi
}

verify_source_identity

temporary_parent=$(cd "${TMPDIR:-/tmp}" && pwd -P)
temporary_root=$(mktemp -d "${temporary_parent}/mkd-web-build.XXXXXXXX")
chmod 700 "${temporary_root}"
source_archive="${temporary_root}/source.tar"
build_context="${temporary_root}/context"
mkdir -m 700 "${build_context}"

validate_snapshot_tree
git -C "${repo_root}" archive --format=tar --output="${source_archive}" "${actual_web_commit}"
chmod 400 "${source_archive}"
snapshot_commit=$(git get-tar-commit-id < "${source_archive}")
snapshot_tree=$(git -C "${repo_root}" rev-parse "${snapshot_commit}^{tree}")
if [[ "${snapshot_commit}" != "${actual_web_commit}" \
  || "${snapshot_tree}" != "${actual_web_source_tree}" ]]; then
  printf 'Git archive identity does not match the verified Web OCI source\n' >&2
  exit 65
fi
source_archive_digest=$(shasum -a 256 "${source_archive}" | awk '{print $1}')

while IFS= read -r member <&3 && IFS= read -r verbose_member <&4; do
  normalized=${member#./}
  member_type=${verbose_member:0:1}
  if [[ -z "${normalized}" \
    || "${normalized}" == /* \
    || "/${normalized}/" == *'/../'* \
    || "/${normalized}/" == *'/./'* ]]; then
    printf 'unsafe Web OCI snapshot member: %s\n' "${member}" >&2
    exit 65
  fi
  if [[ "${member_type}" != - && "${member_type}" != d ]]; then
    printf 'unsupported Web OCI snapshot member type: %s\n' "${member}" >&2
    exit 65
  fi
done 3< <(tar -tf "${source_archive}") 4< <(tar -tvf "${source_archive}")

tar -xf "${source_archive}" -C "${build_context}"
chmod -R a-w "${build_context}"
snapshot_digest=$(calculate_snapshot_digest)
if [[ ! "${source_archive_digest}" =~ ^[0-9a-f]{64}$ \
  || ! "${snapshot_digest}" =~ ^[0-9a-f]{64}$ ]]; then
  printf 'Web OCI snapshot digest calculation failed\n' >&2
  exit 65
fi
verify_snapshot

source_date_epoch=$(git -C "${repo_root}" show -s --format=%ct "${snapshot_commit}")
web_branch=$(git -C "${repo_root}" branch --show-current)
if [[ ! "${source_date_epoch}" =~ ^[0-9]{9,12}$ ]]; then
  printf 'SOURCE_DATE_EPOCH could not be resolved from the source commit\n' >&2
  exit 65
fi

(
  cd "${repo_root}"
  npm ci --ignore-scripts --prefix apps/web-admin
  npm audit --prefix apps/web-admin --audit-level=moderate
  npm test
  npm run check --prefix apps/web-admin
  npm run test:customer --prefix apps/web-admin
  APP_COMMIT_SHA="${snapshot_commit}" \
    APP_BRANCH="${web_branch}" \
    SOURCE_DATE_EPOCH="${source_date_epoch}" \
    npm run build --prefix apps/web-admin
  node scripts/verify-delivery-boundary.mjs
  bash scripts/verify-git-history.sh
)

mkdir -p "${output_dir}"

build_archive() {
  local platform=$1
  local architecture=$2
  local archive="${output_dir}/mkd-web-linux-${architecture}.oci.tar"
  local partial="${archive}.partial"

  verify_snapshot

  "${docker_bin}" buildx build \
    --platform "${platform}" \
    --provenance=false \
    --sbom=false \
    --build-arg "NODE_BUILD_IMAGE=${node_build_image}" \
    --build-arg "NODE_RUNTIME_IMAGE=${node_runtime_image}" \
    --build-arg "WEB_COMMIT_SHA=${snapshot_commit}" \
    --build-arg "WEB_SOURCE_TREE=${snapshot_tree}" \
    --build-arg "WEB_BRANCH=${web_branch}" \
    --build-arg "SOURCE_DATE_EPOCH=${source_date_epoch}" \
    --tag "mkd-web:2.1.8-customer.1-${architecture}" \
    --output "type=oci,dest=${partial}" \
    --file "${build_context}/container/web/Containerfile" \
    "${build_context}"
  verify_snapshot
  mv -- "${partial}" "${archive}"
}

build_archive linux/amd64 amd64
build_archive linux/arm64 arm64

(
  cd "${output_dir}"
  shasum -a 256 \
    mkd-web-linux-amd64.oci.tar \
    mkd-web-linux-arm64.oci.tar > SHA256SUMS
)

"${repo_root}/scripts/verify-web-oci.sh" \
  "${output_dir}/mkd-web-linux-amd64.oci.tar" \
  linux/amd64 \
  "${output_dir}/SHA256SUMS" \
  "${snapshot_commit}" \
  "${snapshot_tree}"
"${repo_root}/scripts/verify-web-oci.sh" \
  "${output_dir}/mkd-web-linux-arm64.oci.tar" \
  linux/arm64 \
  "${output_dir}/SHA256SUMS" \
  "${snapshot_commit}" \
  "${snapshot_tree}"

printf 'Web OCI archives and SHA256SUMS created under %s\n' "${output_dir}"
