#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
web_commit_sha=${WEB_COMMIT_SHA:-}
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
if [[ "$(git -C "${repo_root}" rev-parse HEAD)" != "${web_commit_sha}" ]]; then
  printf 'WEB_COMMIT_SHA does not match the checked-out commit\n' >&2
  exit 65
fi
if [[ -n "$(git -C "${repo_root}" status --porcelain --untracked-files=normal)" ]]; then
  printf 'Web OCI builds require a clean customer-delivery worktree\n' >&2
  exit 65
fi

source_date_epoch=$(git -C "${repo_root}" show -s --format=%ct "${web_commit_sha}")
web_branch=$(git -C "${repo_root}" branch --show-current)
if [[ ! "${source_date_epoch}" =~ ^[0-9]{9,12}$ ]]; then
  printf 'SOURCE_DATE_EPOCH could not be resolved from the source commit\n' >&2
  exit 65
fi

mkdir -p "${output_dir}"

build_archive() {
  local platform=$1
  local architecture=$2
  local archive="${output_dir}/mkd-web-linux-${architecture}.oci.tar"
  local partial="${archive}.partial"

  "${docker_bin}" buildx build \
    --platform "${platform}" \
    --provenance=false \
    --sbom=false \
    --build-arg "NODE_BUILD_IMAGE=${node_build_image}" \
    --build-arg "NODE_RUNTIME_IMAGE=${node_runtime_image}" \
    --build-arg "WEB_COMMIT_SHA=${web_commit_sha}" \
    --build-arg "WEB_BRANCH=${web_branch}" \
    --build-arg "SOURCE_DATE_EPOCH=${source_date_epoch}" \
    --tag "mkd-web:2.1.8-customer.1-${architecture}" \
    --output "type=oci,dest=${partial}" \
    --file "${repo_root}/container/web/Containerfile" \
    "${repo_root}"
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
  "${output_dir}/SHA256SUMS"
"${repo_root}/scripts/verify-web-oci.sh" \
  "${output_dir}/mkd-web-linux-arm64.oci.tar" \
  linux/arm64 \
  "${output_dir}/SHA256SUMS"

printf 'Web OCI archives and SHA256SUMS created under %s\n' "${output_dir}"
