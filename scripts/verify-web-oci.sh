#!/usr/bin/env bash
set -euo pipefail

archive=${1:-}
expected_platform=${2:-}
sums_file=${3:-}
expected_commit=${4:-}
expected_tree=${5:-}
contract_file=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)/container/web/runtime-contract.json

if [[ "$#" -ne 5 || ! -f "${archive}" || ! -f "${sums_file}" || ! -f "${contract_file}" ]]; then
  printf 'usage: %s <oci-archive> <linux/amd64|linux/arm64> <SHA256SUMS> <expected-commit> <expected-tree>\n' "$0" >&2
  exit 64
fi
if [[ "${expected_platform}" != linux/amd64 && "${expected_platform}" != linux/arm64 ]]; then
  printf 'unsupported expected platform: %s\n' "${expected_platform}" >&2
  exit 64
fi
if [[ ! "${expected_commit}" =~ ^[0-9a-f]{40}$ ]]; then
  printf 'expected commit must be exactly 40 lowercase hexadecimal characters\n' >&2
  exit 64
fi
if [[ ! "${expected_tree}" =~ ^[0-9a-f]{40}$ ]]; then
  printf 'expected tree must be exactly 40 lowercase hexadecimal characters\n' >&2
  exit 64
fi
for command_name in grep jq shasum strings tar; do
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
if ! jq -e '
  .config.User == "65532:65532"
  and .config.Entrypoint == ["/nodejs/bin/node"]
  and .config.Cmd == ["dist/index.cjs"]
  and .config.ArgsEscaped == true
  and .config.Env == [
    "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    "SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt",
    "NODE_ENV=production",
    "PORT=8080",
    "DOTENV_CONFIG_PATH=/run/secrets/mkd-web.env"
  ]
  and .config.ExposedPorts == {"8080/tcp": {}}
  and .config.StopSignal == "SIGTERM"
' "${config_blob}" >/dev/null; then
  printf 'Web OCI runtime config contract does not match\n' >&2
  exit 66
fi

actual_revision=$(jq -r '.config.Labels["org.opencontainers.image.revision"] // empty' "${config_blob}")
if [[ "${actual_revision}" != "${expected_commit}" ]]; then
  printf 'Web OCI revision label does not match the expected commit\n' >&2
  exit 66
fi
actual_tree=$(jq -r '.config.Labels["com.leo.mkd.source-tree"] // empty' "${config_blob}")
if [[ "${actual_tree}" != "${expected_tree}" ]]; then
  printf 'Web OCI source-tree label does not match the expected tree\n' >&2
  exit 66
fi
if ! jq -e --arg revision "${expected_commit}" --arg tree "${expected_tree}" '
  .config.Labels == {
    "org.opencontainers.image.title": "mkd-customer-ops-web",
    "org.opencontainers.image.version": "2.1.8-customer.1",
    "org.opencontainers.image.revision": $revision,
    "com.leo.mkd.source-tree": $tree
  }
' "${config_blob}" >/dev/null; then
  printf 'Web OCI image labels do not match the exact release contract\n' >&2
  exit 66
fi

jq -e '
  .schema == "mkd-web-runtime/v1"
  and .user == "65532:65532"
  and .read_only_root == true
  and .cap_drop == ["ALL"]
  and .security_opt == ["no-new-privileges"]
' "${contract_file}" >/dev/null

layer_count=0
marker_sop_matrix='SOP''_V3_MATRIX'
marker_official_rules='OFFICIAL''_RULES_DIGEST'
marker_ads_sop='ADS''_PROMOTION_SOP'
marker_history_sop='LEARNED''_FROM_HISTORY_SOP'
marker_rule_task='ruleTask''Generator'
marker_metrics_sql='01''_refresh_metrics.sql'
marker_classification_sql='02''_refresh_classification.sql'
marker_prompt_role='你是美客多智利站''专属运营顾问'
marker_prompt_structure='严格依以下结构''输出'
forbidden_content_pattern="/Users/leo/|CodexWorking|tmp/worktrees|/src/apps/web-admin|${marker_sop_matrix}|${marker_official_rules}|${marker_ads_sop}|${marker_history_sop}|${marker_rule_task}|${marker_metrics_sql}|${marker_classification_sql}|${marker_prompt_role}|${marker_prompt_structure}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|(ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|(AKIA|LTAI)[A-Z0-9]{12,}|(PGPASSWORD|SESSION_SECRET|AI_API_KEY|MODEL_API_KEY)=[^[:space:]#][^[:space:]]*|postgres(ql)?://[^:[:space:]]+:[^@[:space:]]+@"
while IFS= read -r layer_digest; do
  layer_blob=$(digest_blob "${layer_digest}")
  [[ -f "${layer_blob}" ]] || { printf 'layer blob is missing\n' >&2; exit 66; }
  [[ "$(shasum -a 256 "${layer_blob}" | awk '{print $1}')" == "${layer_digest#sha256:}" ]] || {
    printf 'layer digest verification failed\n' >&2
    exit 66
  }
  while IFS= read -r member <&3 && IFS= read -r verbose_member <&4; do
    normalized=${member#./}
    if [[ "${normalized}" == /* || "/${normalized}/" == *'/../'* ]]; then
      printf 'unsafe OCI layer member: %s\n' "${member}" >&2
      exit 66
    fi
    member_type=${verbose_member:0:1}
    if [[ "${member_type}" == l || "${member_type}" == h ]]; then
      if [[ "${normalized}" == app || "${normalized}" == app/* ]]; then
        printf 'forbidden Web OCI app link: %s\n' "${member}" >&2
        exit 66
      fi
    fi
    if [[ "${normalized}" =~ (^|/)app/(server|client|shared|tests|script)(/|$) \
      || "${normalized}" =~ (^|/)\.git(/|$) \
      || "${normalized}" =~ \.(map|pem|key|p8|p12|pfx)$ \
      || "${normalized}" =~ (^|/)\.env($|\.) ]]; then
      printf 'forbidden Web OCI layer path: %s\n' "${member}" >&2
      exit 66
    fi
  done 3< <(tar -tf "${layer_blob}") 4< <(tar -tvf "${layer_blob}")

  layer_strings="${temporary_root}/layer-$((layer_count + 1)).strings"
  if ! tar -xOf "${layer_blob}" 2>/dev/null | strings -a > "${layer_strings}"; then
    printf 'OCI layer content extraction failed\n' >&2
    exit 66
  fi
  if grep -aEq "${forbidden_content_pattern}" "${layer_strings}"; then
    printf 'forbidden Web OCI layer content detected in layer %s\n' "$((layer_count + 1))" >&2
    exit 66
  fi
  layer_count=$((layer_count + 1))
done < <(jq -r '.layers[].digest' "${manifest_blob}")

if [[ "${layer_count}" -lt 1 ]]; then
  printf 'OCI manifest contains no layers\n' >&2
  exit 66
fi

printf 'Web OCI verified: archive=%s platform=%s config=%s manifest=%s layers=%s revision=%s source-tree=%s SHA256SUMS=pass runtime-contract.json=pass\n' \
  "${archive_name}" "${expected_platform}" "${config_digest}" "${manifest_digest}" "${layer_count}" \
  "${expected_commit}" "${expected_tree}"
