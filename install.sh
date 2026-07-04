#!/usr/bin/env bash
set -euo pipefail

repo="${MEV_GITHUB_REPO:-akitorahayashi/mev-ts}"
version="${MEV_VERSION:-latest}"
install_dir="${MEV_INSTALL_DIR:-$HOME/.local/bin}"
binary_name="mev"

if [[ "$(uname -s)" != "Darwin" ]]; then
	echo "mev installer supports macOS only." >&2
	exit 1
fi

arch="$(uname -m)"
case "$arch" in
arm64 | aarch64) target="darwin-arm64" ;;
x86_64 | amd64) target="darwin-x64" ;;
*)
	echo "Unsupported architecture: $arch (available: darwin-arm64, darwin-x64)" >&2
	exit 1
	;;
esac

if ! command -v curl >/dev/null 2>&1; then
	echo "curl is required but was not found in PATH." >&2
	exit 1
fi

if ! command -v shasum >/dev/null 2>&1; then
	echo "shasum is required but was not found in PATH." >&2
	exit 1
fi

if [[ -n "${MEV_BINARY_URL:-}" ]]; then
	binary_url="$MEV_BINARY_URL"
elif [[ "$version" == "latest" ]]; then
	binary_url="https://github.com/${repo}/releases/latest/download/${binary_name}-${target}"
else
	binary_url="https://github.com/${repo}/releases/download/${version}/${binary_name}-${target}"
fi

tmp_dir=""
cleanup() {
	status=$?
	trap - EXIT INT TERM HUP
	if [[ -n "$tmp_dir" && -d "$tmp_dir" ]]; then
		if ! rm -rf "$tmp_dir"; then
			echo "Warning: failed to remove temporary directory: $tmp_dir" >&2
		fi
	fi
	exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

if [[ -n "${TMPDIR:-}" ]]; then
	tmp_dir="$(mktemp -d "${TMPDIR%/}/mev.XXXXXX")"
else
	tmp_dir="$(mktemp -d -t mev.XXXXXX)"
fi
tmp_file="${tmp_dir}/${binary_name}"
checksum_file="${tmp_dir}/${binary_name}.sha256"

echo "Downloading ${binary_name} for ${target} from ${binary_url}..."
curl -fsSL -o "$tmp_file" -- "$binary_url"

if [[ -n "${MEV_BINARY_SHA256:-}" ]]; then
	expected_sha256="$MEV_BINARY_SHA256"
else
	if [[ -n "${MEV_BINARY_SHA256_URL:-}" ]]; then
		checksum_url="$MEV_BINARY_SHA256_URL"
	else
		checksum_url="${binary_url}.sha256"
	fi
	echo "Downloading SHA256 checksum from ${checksum_url}..."
	curl -fsSL -o "$checksum_file" -- "$checksum_url"
	expected_sha256="$(awk '{print $1}' "$checksum_file")"
fi

if [[ ! "$expected_sha256" =~ ^[[:xdigit:]]{64}$ ]]; then
	echo "Invalid SHA256 checksum format: ${expected_sha256}" >&2
	exit 1
fi

actual_sha256="$(shasum -a 256 "$tmp_file" | awk '{print $1}')"
if [[ "$actual_sha256" != "$expected_sha256" ]]; then
	echo "SHA256 mismatch: expected ${expected_sha256}, got ${actual_sha256}" >&2
	exit 1
fi

mkdir -p "$install_dir"
install -m 755 "$tmp_file" "${install_dir}/${binary_name}"

echo "Installed to ${install_dir}/${binary_name}"

case ":${PATH}:" in
*":${install_dir}:"*) echo "Run: ${binary_name} --version" ;;
*)
	echo "Note: ${install_dir} is not on PATH yet."
	echo "Run it once by full path to provision your shell:"
	echo "  ${install_dir}/${binary_name} make shell"
	echo "Then restart your shell and run: ${binary_name} --version"
	;;
esac
