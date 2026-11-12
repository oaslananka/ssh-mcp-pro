#!/usr/bin/env bash
# Install official Node 26 LTS into a private Linux / WSL user directory.
# Archive digest must match a release-key-verified, signed Node.js manifest.
set -euo pipefail
fail() {
  printf 'bootstrap-node: %s\n' "$*" >&2
  return 1
}
select_archive_entry() {
  local manifest="$1" arch="$2"
  [[ "$arch" == "x64" || "$arch" == "arm64" ]] || return 1
  awk -v arch="$arch" '
    $1 ~ /^[0-9a-f]+$/ && length($1) == 64 &&
    $2 ~ ("^node-v26\\.[0-9]+\\.[0-9]+-linux-" arch "\\.tar\\.xz$") {
      matches++; hash=$1; filename=$2
    }
    END {
      if (matches != 1) exit 1
      print hash, filename
    }
  ' "$manifest"
}
bootstrap_node_lts() (
  set -euo pipefail
  [[ "$(uname -s)" == "Linux" ]] || { fail "automatic Node installation supports Linux / WSL only"; exit 1; }
  local architecture arch root stage expected archive release destination node
  architecture="$(uname -m)"
  case "$architecture" in
    x86_64) arch="x64" ;;
    aarch64 | arm64) arch="arm64" ;;
    *) fail "unsupported CPU architecture: $architecture; install official Node 26 LTS manually"; exit 1 ;;
  esac
  for tool in curl gpgv sha256sum tar mktemp; do
    command -v "$tool" >/dev/null 2>&1 ||
      { fail "'$tool' is required to verify official Node binaries"; exit 1; }
  done

  root="${HOME}/.local/share/ssh-mcp-pro/node-runtimes"
  [[ "$root" == /* && ! -L "$root" ]] || { fail "invalid or symlinked runtime directory"; exit 1; }
  mkdir -p -m 0700 "$root"
  [[ "$(stat -c %u "$root")" == "$(id -u)" ]] || { fail "runtime directory is not user-owned"; exit 1; }
  chmod 0700 "$root"
  stage="$(mktemp -d "$root/.node-download.XXXXXXXX")"
  trap 'rm -rf -- "$stage"' EXIT

  local source="https://nodejs.org/dist/latest-v26.x"
  curl --proto '=https' --tlsv1.2 -fsSL --retry 2 --connect-timeout 12 --max-time 60 \
    -o "$stage/SHASUMS256.txt.asc" "$source/SHASUMS256.txt.asc"
  curl --proto '=https' --tlsv1.2 -fsSL --retry 2 --connect-timeout 12 --max-time 60 \
    -o "$stage/release-keys.kbx" "https://raw.githubusercontent.com/nodejs/release-keys/HEAD/gpg/pubring.kbx"

  gpgv --quiet --keyring "$stage/release-keys.kbx" --output "$stage/SHASUMS256.txt" \
    "$stage/SHASUMS256.txt.asc" >/dev/null 2>&1 ||
    { fail "Node.js release signature verification failed"; exit 1; }
  read -r expected archive < <(select_archive_entry "$stage/SHASUMS256.txt" "$arch") ||
    { fail "no unique signed Node 26 LTS archive for Linux $arch"; exit 1; }
  [[ "$expected" =~ ^[a-f0-9]{64}$ && "$archive" =~ ^node-v26\.[0-9]+\.[0-9]+-linux-(x64|arm64)\.tar\.xz$ ]] ||
    { fail "malformed signed Node.js archive name"; exit 1; }
  release="${archive%.tar.xz}"
  destination="$root/$release"
  if [[ ! -d "$destination" ]]; then
    curl --proto '=https' --tlsv1.2 -fsSL --retry 2 --connect-timeout 12 --max-time 180 \
      -o "$stage/$archive" "$source/$archive"
    printf '%s  %s\n' "$expected" "$stage/$archive" | sha256sum --check --status ||
      { fail "Node.js archive checksum mismatch"; exit 1; }
    tar --no-same-owner -xJf "$stage/$archive" -C "$stage" ||
      { fail "unable to extract verified Node.js archive"; exit 1; }
    [[ -x "$stage/$release/bin/node" && -f "$stage/$release/bin/npm" ]] ||
      { fail "verified Node.js package is incomplete"; exit 1; }
    mv --no-clobber "$stage/$release" "$destination"
  fi
  node="$destination/bin/node"
  [[ -x "$node" && -f "$destination/bin/npm" ]] ||
    { fail "private Node.js runtime is incomplete"; exit 1; }
  "$node" -e 'if (process.versions.node.split(".")[0] !== "26") process.exit(1)' ||
    { fail "Node 26 LTS cannot run; check Linux dependencies such as libatomic1"; exit 1; }
  printf 'bootstrap-node: verified private runtime %s\n' "$("$node" -v)" >&2
  printf '%s\n' "$node"
)
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  case "${1:-}" in
    --help) echo "Install verified Node 26 LTS for Linux / WSL into a private user directory." ;;
    "") bootstrap_node_lts ;;
    *) fail "unknown argument" ;;
  esac
fi
