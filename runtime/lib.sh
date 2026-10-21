# Helpers shared by build.sh and smoke-test.sh. Runs under bash on Linux, macOS and
# Git Bash on Windows.

log() { printf '[runtime] %s\n' "$*" >&2; }
die() { printf '[runtime] error: %s\n' "$*" >&2; exit 1; }

is_windows() {
  case "$(uname -s)" in MINGW* | MSYS* | CYGWIN*) return 0 ;; *) return 1 ;; esac
}

# Executable suffix for a target name such as win32-x64.
exe_suffix() {
  case "$1" in win32-*) printf '.exe' ;; *) printf '' ;; esac
}

sha256_of() {
  if command -v sha256sum > /dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

# verify_sha256 <file> <expected hex digest>
verify_sha256() {
  local actual expected
  actual="$(sha256_of "$1")"
  expected="$(printf '%s' "$2" | tr 'A-F' 'a-f')"
  [ "$actual" = "$expected" ] || die "checksum mismatch for $1: expected $expected, got $actual"
  log "checksum ok: $(basename "$1")"
}

# download <url> <destination>. Skips the download when the file is already there; the
# caller verifies the checksum either way, so a corrupt cached file still fails.
download() {
  if [ -s "$2" ]; then
    log "cached: $(basename "$2")"
    return
  fi
  log "download: $1"
  mkdir -p "$(dirname "$2")"
  curl -fsSL --retry 3 --retry-delay 5 -o "$2.part" "$1" || die "download failed: $1"
  mv "$2.part" "$2"
}

# extract <archive> <empty destination directory>. Both are POSIX paths: GNU tar in Git
# Bash reads "C:/..." as a remote host, while "/c/..." works.
extract() {
  local archive="$1" dest="$2"
  mkdir -p "$dest"
  case "$archive" in
    *.tar.gz | *.tgz) tar -xzf "$archive" -C "$dest" ;;
    *.zip)
      if command -v unzip > /dev/null 2>&1; then
        unzip -q "$archive" -d "$dest"
      elif command -v 7z > /dev/null 2>&1; then
        7z x -y -bd "-o$dest" "$archive" > /dev/null
      else
        powershell.exe -NoProfile -Command "Expand-Archive -LiteralPath '$(cygpath -w "$archive")' -DestinationPath '$(cygpath -w "$dest")'"
      fi
      ;;
    *) die "unknown archive type: $archive" ;;
  esac
}

# The single directory an archive unpacked into.
only_child() {
  local entries
  entries="$(ls -A "$1")"
  [ "$(printf '%s\n' "$entries" | wc -l | tr -d ' ')" = 1 ] || die "expected one directory in $1, found: $entries"
  printf '%s/%s' "$1" "$entries"
}

# A path a native Windows program accepts (C:/a/b); unchanged elsewhere.
native_path() {
  if is_windows; then cygpath -m "$1"; else printf '%s' "$1"; fi
}
