#!/usr/bin/env bash
# Builds the ARTEL runtime bundle.
#
#   runtime/build.sh common                    jar, artel-home dist and agent-server source
#   runtime/build.sh bundle <target> <version> one bundle from an existing common build
#   runtime/build.sh <target> <version>        both, skipping common when it already exists
#
# <target> is linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64 or win32-arm64 and
# must match the machine: pgvector is compiled and the agent-server wheels are installed on it.
# On Windows run it from Git Bash inside a Visual Studio developer environment (cl, nmake).
#
# Environment:
#   ARTEL_ORCHESTRATION_REPO, ARTEL_ORCHESTRATION_REF   default project-artel/artel-orchestration-server, develop
#   ARTEL_AGENT_SERVER_REPO,  ARTEL_AGENT_SERVER_REF    default project-artel/artel-agent-server, develop
#   ARTEL_HOME_REPO,          ARTEL_HOME_REF            default project-artel/artel-home, develop
#   ARTEL_BUILD_DIR    work directory, default runtime/build
#   ARTEL_COMMON_DIR   common build output, default $ARTEL_BUILD_DIR/common
#
# A repository can be a local path; a ref can be a branch, a tag or a commit SHA.
#
# common needs git, a JDK 21 (JAVA_HOME or java on PATH), Node 22 or later with npm, and
# python3 3.11 or later. bundle needs curl, tar, and make with a C compiler (POSIX) or cl
# and nmake (Windows).
#
# Output: $ARTEL_BUILD_DIR/out/artel-runtime-<version>-<target>.tar.gz and .sha256.
set -euo pipefail

RUNTIME_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$RUNTIME_DIR/lib.sh"
# shellcheck source=versions.env
. "$RUNTIME_DIR/versions.env"

BUILD_DIR="${ARTEL_BUILD_DIR:-$RUNTIME_DIR/build}"
COMMON_DIR="${ARTEL_COMMON_DIR:-$BUILD_DIR/common}"
CACHE_DIR="$BUILD_DIR/cache"
OUT_DIR="$BUILD_DIR/out"

ORCHESTRATION_REPO="${ARTEL_ORCHESTRATION_REPO:-https://github.com/project-artel/artel-orchestration-server.git}"
ORCHESTRATION_REF="${ARTEL_ORCHESTRATION_REF:-develop}"
AGENT_SERVER_REPO="${ARTEL_AGENT_SERVER_REPO:-https://github.com/project-artel/artel-agent-server.git}"
AGENT_SERVER_REF="${ARTEL_AGENT_SERVER_REF:-develop}"
HOME_REPO="${ARTEL_HOME_REPO:-https://github.com/project-artel/artel-home.git}"
HOME_REF="${ARTEL_HOME_REF:-develop}"

usage() {
  sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

# ---------------------------------------------------------------------------------------------
# common: the platform-independent parts, built once and reused by every target.

# fetch_source <repo> <ref> <dest>; prints the commit SHA.
fetch_source() {
  rm -rf "$3"
  git init -q "$3"
  git -C "$3" fetch -q --depth 1 "$1" "$2" || die "cannot fetch $2 from $1"
  git -C "$3" -c advice.detachedHead=false checkout -q FETCH_HEAD
  git -C "$3" rev-parse HEAD
}

jdk_tool() {
  if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/$1" ]; then
    printf '%s' "$JAVA_HOME/bin/$1"
  elif command -v "$1" > /dev/null 2>&1; then
    command -v "$1"
  else
    die "$1 not found: set JAVA_HOME to a JDK 21"
  fi
}

# Modules the Spring Boot fat jar needs, from jdeps over its classes and nested jars.
java_modules_for_jar() {
  local work="$BUILD_DIR/jdeps"
  rm -rf "$work"
  mkdir -p "$work"
  (cd "$work" && "$(jdk_tool jar)" xf "$(native_path "$1")")
  local sep=':' classpath=''
  is_windows && sep=';'
  for lib in "$work"/BOOT-INF/lib/*.jar; do
    classpath="${classpath:+$classpath$sep}$(native_path "$lib")"
  done
  "$(jdk_tool jdeps)" --ignore-missing-deps --multi-release 21 --print-module-deps -q --recursive \
    --class-path "$classpath" "$(native_path "$work/BOOT-INF/classes")"
  rm -rf "$work"
}

build_common() {
  local src="$BUILD_DIR/src"
  rm -rf "$COMMON_DIR"
  mkdir -p "$COMMON_DIR" "$src"

  log "orchestration: $ORCHESTRATION_REPO $ORCHESTRATION_REF"
  local orchestration_sha
  orchestration_sha="$(fetch_source "$ORCHESTRATION_REPO" "$ORCHESTRATION_REF" "$src/orchestration")"
  (cd "$src/orchestration" && chmod +x mvnw && ./mvnw -B -q -DskipTests package)
  local jar
  jar="$(ls "$src"/orchestration/target/artel-orchestration-server-*.jar | grep -v -e '-plain\.jar$' | head -n 1)"
  [ -f "$jar" ] || die "orchestration jar not found under $src/orchestration/target"
  cp "$jar" "$COMMON_DIR/orchestration.jar"
  java_modules_for_jar "$COMMON_DIR/orchestration.jar" | tr -d '\r' > "$COMMON_DIR/java-modules.txt"
  [ -s "$COMMON_DIR/java-modules.txt" ] || die "jdeps reported no modules"
  log "jdeps modules: $(cat "$COMMON_DIR/java-modules.txt")"

  log "artel-home: $HOME_REPO $HOME_REF"
  local home_sha
  home_sha="$(fetch_source "$HOME_REPO" "$HOME_REF" "$src/home")"
  (cd "$src/home" && npm ci --no-audit --no-fund && VITE_ORCHESTRATION_URL=__ARTEL_ORCHESTRATION_URL__ npm run build)
  cp -R "$src/home/dist" "$COMMON_DIR/home"

  log "agent-server: $AGENT_SERVER_REPO $AGENT_SERVER_REF"
  local agent_server_sha
  agent_server_sha="$(fetch_source "$AGENT_SERVER_REPO" "$AGENT_SERVER_REF" "$src/agent-server")"
  mkdir -p "$COMMON_DIR/agent-server"
  tar -C "$src/agent-server" -cf - --exclude='__pycache__' app | tar -C "$COMMON_DIR/agent-server" -xf -
  # Same dependency list the agent-server Dockerfile installs: [project].dependencies.
  python3 -I -c 'import sys, tomllib; print("\n".join(tomllib.load(open(sys.argv[1], "rb"))["project"]["dependencies"]))' \
    "$src/agent-server/pyproject.toml" > "$COMMON_DIR/requirements.txt"

  cat > "$COMMON_DIR/sources.env" << EOF
ORCHESTRATION_SHA=$orchestration_sha
AGENT_SERVER_SHA=$agent_server_sha
HOME_SHA=$home_sha
EOF
  rm -rf "$src"
  log "common build ready in $COMMON_DIR"
}

# ---------------------------------------------------------------------------------------------
# bundle: one target.

check_host() {
  local target="$1" os arch
  case "$(uname -s)" in
    Linux) os=linux ;;
    Darwin) os=darwin ;;
    MINGW* | MSYS* | CYGWIN*) os=win32 ;;
    *) die "unsupported build host: $(uname -s)" ;;
  esac
  [ "${target%%-*}" = "$os" ] || die "target $target cannot be built on $os"
  # Git Bash may itself run under x64 emulation on Windows arm64, so its uname is not a
  # reliable answer there; trust the target on Windows.
  if [ "$os" != win32 ]; then
    case "$(uname -m)" in
      x86_64 | amd64) arch=x64 ;;
      aarch64 | arm64) arch=arm64 ;;
      *) die "unsupported build architecture: $(uname -m)" ;;
    esac
    [ "${target#*-}" = "$arch" ] || die "target $target cannot be built on $os-$arch"
  fi
}

stage_postgres() {
  local triple="$1" stage="$2" tmp="$3"
  local name="postgresql-$PG_RELEASE-$triple.tar.gz"
  local url="https://github.com/theseus-rs/postgresql-binaries/releases/download/$PG_RELEASE/$name"
  download "$url.sha256" "$CACHE_DIR/$name.sha256.txt"
  download "$url" "$CACHE_DIR/$name"
  verify_sha256 "$CACHE_DIR/$name" "$(cut -d' ' -f1 < "$CACHE_DIR/$name.sha256.txt")"
  extract "$CACHE_DIR/$name" "$tmp/postgres"
  mv "$(only_child "$tmp/postgres")" "$stage/postgres"
}

build_pgvector() {
  local target="$1" stage="$2" tmp="$3"
  local name="pgvector-$PGVECTOR_VERSION.tar.gz"
  download "https://github.com/pgvector/pgvector/archive/refs/tags/v$PGVECTOR_VERSION.tar.gz" "$CACHE_DIR/$name"
  verify_sha256 "$CACHE_DIR/$name" "$PGVECTOR_SHA256"
  extract "$CACHE_DIR/$name" "$tmp/pgvector"
  local src
  src="$(only_child "$tmp/pgvector")"

  case "$target" in
    win32-*)
      command -v cl > /dev/null 2>&1 && command -v nmake > /dev/null 2>&1 \
        || die "cl and nmake not on PATH: run inside a Visual Studio developer environment"
      local pgroot libs=''
      pgroot="$(cygpath -w "$stage/postgres")"
      # Meson-built PostgreSQL names the server import library postgres.exe.lib, while
      # pgvector's Makefile.win links postgres.lib.
      if [ ! -f "$stage/postgres/lib/postgres.lib" ] && [ -f "$stage/postgres/lib/postgres.exe.lib" ]; then
        libs="LIBS=\"$pgroot\\lib\\postgres.exe.lib\""
      fi
      # cmd.exe runs nmake so Git Bash neither rewrites /F into a path nor puts its own
      # link.exe ahead of the MSVC linker.
      cat > "$tmp/pgvector.bat" << EOF
@echo off
cd /d "$(cygpath -w "$src")" || exit /b 1
nmake /nologo /F Makefile.win PGROOT="$pgroot" OPTFLAGS= $libs || exit /b 1
nmake /nologo /F Makefile.win PGROOT="$pgroot" OPTFLAGS= $libs install || exit /b 1
EOF
      MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' cmd.exe /c "$(cygpath -w "$tmp/pgvector.bat")"
      ;;
    *)
      # OPTFLAGS="" drops -march=native, so the library runs on any CPU of the target
      # architecture, not only the build machine's.
      local args=(OPTFLAGS= "PG_CONFIG=$stage/postgres/bin/pg_config")
      # pgxs carries the SDK path of the machine PostgreSQL was built on.
      [ "${target%%-*}" = darwin ] && args+=("PG_SYSROOT=$(xcrun --show-sdk-path)")
      make -C "$src" -j 4 "${args[@]}"
      make -C "$src" "${args[@]}" install
      ;;
  esac
  [ -f "$stage/postgres/share/extension/vector.control" ] || die "pgvector did not install vector.control"
}

stage_java() {
  local target="$1" stage="$2" tmp="$3" os arch ext
  case "$target" in
    linux-*) os=linux ext=tar.gz ;;
    darwin-*) os=mac ext=tar.gz ;;
    win32-*) os=windows ext=zip ;;
  esac
  case "$target" in *-x64) arch=x64 ;; *-arm64) arch=aarch64 ;; esac
  local tag="jdk-${JAVA_RELEASE/+/%2B}"
  local name="OpenJDK21U-jdk_${arch}_${os}_hotspot_${JAVA_RELEASE/+/_}.$ext"
  local url="https://github.com/adoptium/temurin21-binaries/releases/download/$tag/$name"
  download "$url.sha256.txt" "$CACHE_DIR/$name.sha256.txt"
  download "$url" "$CACHE_DIR/$name"
  verify_sha256 "$CACHE_DIR/$name" "$(cut -d' ' -f1 < "$CACHE_DIR/$name.sha256.txt")"
  extract "$CACHE_DIR/$name" "$tmp/jdk"
  local jdk
  jdk="$(only_child "$tmp/jdk")"
  [ -d "$jdk/Contents/Home" ] && jdk="$jdk/Contents/Home"

  local modules
  modules="$(tr -d '\r\n' < "$COMMON_DIR/java-modules.txt"),$JAVA_EXTRA_MODULES"
  log "jlink modules: $modules"
  "$jdk/bin/jlink$(exe_suffix "$target")" --add-modules "$modules" \
    --strip-debug --no-man-pages --no-header-files --compress=zip-6 \
    --output "$(native_path "$stage/java")"
}

stage_python() {
  local triple="$1" stage="$2" tmp="$3" target="$4"
  local name="cpython-$PYTHON_VERSION+$PBS_RELEASE-$triple-$PBS_FLAVOUR.tar.gz"
  local base="https://github.com/astral-sh/python-build-standalone/releases/download/$PBS_RELEASE"
  download "$base/SHA256SUMS" "$CACHE_DIR/python-build-standalone-$PBS_RELEASE-SHA256SUMS"
  download "$base/${name/+/%2B}" "$CACHE_DIR/$name"
  local expected
  expected="$(awk -v n="$name" '$2 == n { print $1 }' "$CACHE_DIR/python-build-standalone-$PBS_RELEASE-SHA256SUMS")"
  [ -n "$expected" ] || die "$name is not listed in SHA256SUMS of $PBS_RELEASE"
  verify_sha256 "$CACHE_DIR/$name" "$expected"
  extract "$CACHE_DIR/$name" "$tmp/python"
  mv "$(only_child "$tmp/python")" "$stage/python"

  local python
  python="$stage/$(python_path "$target")"
  "$python" -I -m pip install --no-cache-dir --disable-pip-version-check --no-warn-script-location \
    -r "$(native_path "$COMMON_DIR/requirements.txt")"
  # pip is only needed for the install above. The standard library parts below are the IDE,
  # the turtle demos and the bundled pip wheels; nothing in agent-server imports them.
  "$python" -I -m pip uninstall --yes --disable-pip-version-check pip > /dev/null
  find "$stage/python" -depth -type d \( -name idlelib -o -name turtledemo -o -name ensurepip \) \
    -path '*/[Ll]ib/*' -exec rm -rf {} +
}

python_path() {
  case "$1" in win32-*) printf 'python/python.exe' ;; *) printf 'python/bin/python3' ;; esac
}

# Files that are needed to build against PostgreSQL but not to run it.
prune_postgres() {
  local pg="$1/postgres"
  rm -rf "$pg/include" "$pg/lib/pgxs" "$pg/doc" "$pg/share/doc" "$pg/share/man"
  find "$pg/lib" -maxdepth 1 -type f \( -name '*.a' -o -name '*.lib' \) -delete
}

# Every Mach-O file needs a valid signature to run on Apple silicon. Downloaded binaries
# keep theirs; anything whose signature jlink or pip left invalid gets an ad-hoc one.
# Developer ID signing for distribution happens later, in the desktop app build.
adhoc_sign_darwin() {
  local count=0
  while IFS= read -r -d '' file; do
    file -b "$file" | grep -q 'Mach-O' || continue
    codesign --verify "$file" > /dev/null 2>&1 && continue
    codesign --force --sign - "$file"
    count=$((count + 1))
  done < <(find "$1" -type f \( -perm -u+x -o -name '*.dylib' -o -name '*.so' \) -print0)
  log "ad-hoc signed $count Mach-O files"
}

write_manifest() {
  local stage="$1" target="$2" version="$3" exe
  exe="$(exe_suffix "$target")"
  # shellcheck source=/dev/null
  . "$COMMON_DIR/sources.env"
  cat > "$stage/manifest.json" << EOF
{
  "schemaVersion": 1,
  "version": "$version",
  "target": "$target",
  "executables": {
    "postgres": "postgres/bin/postgres$exe",
    "initdb": "postgres/bin/initdb$exe",
    "pg_ctl": "postgres/bin/pg_ctl$exe",
    "pg_isready": "postgres/bin/pg_isready$exe",
    "createdb": "postgres/bin/createdb$exe",
    "java": "java/bin/java$exe",
    "python": "$(python_path "$target")"
  },
  "orchestrationJar": "orchestration/orchestration.jar",
  "agentServerDir": "agent-server",
  "homeDir": "home",
  "components": {
    "postgres": "${PG_RELEASE%.*}",
    "pgvector": "$PGVECTOR_VERSION",
    "java": "${JAVA_RELEASE%%+*}",
    "python": "$PYTHON_VERSION"
  },
  "sources": {
    "orchestration": "$ORCHESTRATION_SHA",
    "agentServer": "$AGENT_SERVER_SHA",
    "home": "$HOME_SHA"
  }
}
EOF
}

bundle() {
  local target="${1:-}" version="${2:-}"
  local pg_triple
  case "$target" in
    linux-x64) pg_triple=x86_64-unknown-linux-gnu ;;
    linux-arm64) pg_triple=aarch64-unknown-linux-gnu ;;
    darwin-x64) pg_triple=x86_64-apple-darwin ;;
    darwin-arm64) pg_triple=aarch64-apple-darwin ;;
    win32-x64) pg_triple=x86_64-pc-windows-msvc ;;
    win32-arm64) pg_triple=aarch64-pc-windows-msvc ;;
    *) usage ;;
  esac
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$ ]] || die "version must look like 0.1.0, got '$version'"
  check_host "$target"
  for file in orchestration.jar java-modules.txt home/index.html agent-server/app requirements.txt sources.env; do
    [ -e "$COMMON_DIR/$file" ] || die "$COMMON_DIR/$file missing: run 'runtime/build.sh common' first"
  done

  local stage="$BUILD_DIR/stage/$target" tmp="$BUILD_DIR/tmp/$target"
  rm -rf "$stage" "$tmp"
  mkdir -p "$stage" "$tmp" "$CACHE_DIR" "$OUT_DIR"

  log "[$target] postgres $PG_RELEASE"
  stage_postgres "$pg_triple" "$stage" "$tmp"
  log "[$target] pgvector $PGVECTOR_VERSION"
  build_pgvector "$target" "$stage" "$tmp"
  prune_postgres "$stage"
  log "[$target] java $JAVA_RELEASE"
  stage_java "$target" "$stage" "$tmp"
  log "[$target] python $PYTHON_VERSION"
  stage_python "$pg_triple" "$stage" "$tmp" "$target"

  mkdir -p "$stage/orchestration" "$stage/agent-server"
  cp "$COMMON_DIR/orchestration.jar" "$stage/orchestration/orchestration.jar"
  cp -R "$COMMON_DIR/home" "$stage/home"
  cp -R "$COMMON_DIR/agent-server/app" "$stage/agent-server/app"
  write_manifest "$stage" "$target" "$version"
  [ "${target%%-*}" = darwin ] && adhoc_sign_darwin "$stage"

  local archive="artel-runtime-$version-$target.tar.gz"
  rm -f "$OUT_DIR/$archive" "$OUT_DIR/$archive.sha256"
  # manifest.json sits at the archive root: unpacking into an empty directory makes that
  # directory the runtime directory. COPYFILE_DISABLE keeps macOS tar from adding ._ files.
  (cd "$stage" && COPYFILE_DISABLE=1 tar -czf "$OUT_DIR/$archive" manifest.json postgres java orchestration python agent-server home)
  (cd "$OUT_DIR" && printf '%s  %s\n' "$(sha256_of "$archive")" "$archive" > "$archive.sha256")
  rm -rf "$tmp"
  log "[$target] $OUT_DIR/$archive ($(du -h "$OUT_DIR/$archive" | cut -f1))"
}

case "${1:-}" in
  common) build_common ;;
  bundle) bundle "${2:-}" "${3:-}" ;;
  linux-* | darwin-* | win32-*)
    [ -f "$COMMON_DIR/sources.env" ] || build_common
    bundle "$1" "${2:-}"
    ;;
  *) usage ;;
esac
