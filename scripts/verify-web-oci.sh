#!/usr/bin/env bash
set -euo pipefail

archive=${1:-}
expected_platform=${2:-}
sums_file=${3:-}
contract_file=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)/container/web/runtime-contract.json

if [[ ! -f "${archive}" || ! -f "${sums_file}" || ! -f "${contract_file}" ]]; then
  printf 'usage: %s <oci-archive> <linux/amd64|linux/arm64> <SHA256SUMS>\n' "$0" >&2
  exit 64
fi
if [[ "${expected_platform}" != linux/amd64 && "${expected_platform}" != linux/arm64 ]]; then
  printf 'unsupported expected platform: %s\n' "${expected_platform}" >&2
  exit 64
fi
for command_name in jq shasum tar; do
  command -v "${command_name}" >/dev/null 2>&1 || {
    printf 'required verifier command is unavailable: %s\n' "${command_name}" >&2
    exit 69
  }
done

archive=$(cd "$(dirname "${archive}")" && pwd -P)/$(basename "${archive}")
sums_file=$(cd "$(dirname "${sums_file}")" && pwd -P)/$(basename "${sums_file}")
archive_name=$(basename "${archive}")
actual_sha=$(shasum -a 256 "${archive}" | awk '{print $1}')
expected_sha=$(awk -v name="${archive_name}" '$2 == name || $2 == "*" name { print $1 }' "${sums_file}")
if [[ ! "${expected_sha}" =~ ^[0-9a-f]{64}$ || "${actual_sha}" != "${expected_sha}" ]]; then
  printf 'SHA256SUMS verification failed for %s\n' "${archive_name}" >&2
  exit 66
fi

temporary_root=$(mktemp -d "${TMPDIR:-/tmp}/mkd-web-oci.XXXXXXXX")
cleanup() {
  if [[ -n "${temporary_root:-}" && -d "${temporary_root}" ]]; then
    chmod -R u+w "${temporary_root}" 2>/dev/null || true
    rm -rf -- "${temporary_root}"
  fi
}
trap cleanup EXIT

while IFS= read -r member; do
  if [[ "${member}" == /* || "/${member}/" == *'/../'* ]]; then
    printf 'unsafe OCI archive member: %s\n' "${member}" >&2
    exit 66
  fi
done < <(tar -tf "${archive}")
tar -xf "${archive}" -C "${temporary_root}"

for required in oci-layout index.json; do
  [[ -f "${temporary_root}/${required}" ]] || {
    printf 'OCI archive is missing %s\n' "${required}" >&2
    exit 66
  }
done
jq -e '.imageLayoutVersion == "1.0.0"' "${temporary_root}/oci-layout" >/dev/null
jq -e '.schemaVersion == 2 and (.manifests | length == 1)' "${temporary_root}/index.json" >/dev/null

digest_blob() {
  local digest=$1
  if [[ ! "${digest}" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    printf 'invalid OCI digest: %s\n' "${digest}" >&2
    exit 66
  fi
  printf '%s/blobs/sha256/%s' "${temporary_root}" "${digest#sha256:}"
}

manifest_digest=$(jq -r '.manifests[0].digest' "${temporary_root}/index.json")
manifest_blob=$(digest_blob "${manifest_digest}")
[[ -f "${manifest_blob}" ]] || { printf 'manifest blob is missing\n' >&2; exit 66; }
[[ "$(shasum -a 256 "${manifest_blob}" | awk '{print $1}')" == "${manifest_digest#sha256:}" ]] || {
  printf 'manifest digest verification failed\n' >&2
  exit 66
}

config_digest=$(jq -r '.config.digest' "${manifest_blob}")
config_blob=$(digest_blob "${config_digest}")
[[ -f "${config_blob}" ]] || { printf 'config blob is missing\n' >&2; exit 66; }
[[ "$(shasum -a 256 "${config_blob}" | awk '{print $1}')" == "${config_digest#sha256:}" ]] || {
  printf 'config digest verification failed\n' >&2
  exit 66
}

expected_os=${expected_platform%/*}
expected_architecture=${expected_platform#*/}
jq -e --arg os "${expected_os}" --arg arch "${expected_architecture}" \
  '.os == $os and .architecture == $arch' "${config_blob}" >/dev/null
jq -e '
  .config.User == "65532:65532"
  and .config.Entrypoint == ["/nodejs/bin/node"]
  and .config.Cmd == ["dist/index.cjs"]
  and (.config.Env | index("NODE_ENV=production") != null)
  and (.config.Env | index("PORT=8080") != null)
  and (.config.Env | index("DOTENV_CONFIG_PATH=/run/secrets/mkd-web.env") != null)
' "${config_blob}" >/dev/null

jq -e '
  .schema == "mkd-web-runtime/v1"
  and .user == "65532:65532"
  and .read_only_root == true
  and .cap_drop == ["ALL"]
  and .security_opt == ["no-new-privileges"]
' "${contract_file}" >/dev/null

layer_count=0
while IFS= read -r layer_digest; do
  layer_blob=$(digest_blob "${layer_digest}")
  [[ -f "${layer_blob}" ]] || { printf 'layer blob is missing\n' >&2; exit 66; }
  [[ "$(shasum -a 256 "${layer_blob}" | awk '{print $1}')" == "${layer_digest#sha256:}" ]] || {
    printf 'layer digest verification failed\n' >&2
    exit 66
  }
  while IFS= read -r member; do
    normalized=${member#./}
    if [[ "${normalized}" == /* || "/${normalized}/" == *'/../'* ]]; then
      printf 'unsafe OCI layer member: %s\n' "${member}" >&2
      exit 66
    fi
    if [[ "${normalized}" =~ (^|/)app/(server|client|shared|tests|script)(/|$) \
      || "${normalized}" =~ (^|/)\.git(/|$) \
      || "${normalized}" =~ \.(map|pem|key|p8|p12|pfx)$ \
      || "${normalized}" =~ (^|/)\.env($|\.) ]]; then
      printf 'forbidden Web OCI layer path: %s\n' "${member}" >&2
      exit 66
    fi
  done < <(tar -tf "${layer_blob}")
  layer_count=$((layer_count + 1))
done < <(jq -r '.layers[].digest' "${manifest_blob}")

if [[ "${layer_count}" -lt 1 ]]; then
  printf 'OCI manifest contains no layers\n' >&2
  exit 66
fi

printf 'Web OCI verified: archive=%s platform=%s config=%s manifest=%s layers=%s SHA256SUMS=pass runtime-contract.json=pass\n' \
  "${archive_name}" "${expected_platform}" "${config_digest}" "${manifest_digest}" "${layer_count}"
