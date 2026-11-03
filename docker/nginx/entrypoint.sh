#!/bin/sh
set -eu

# Validate before envsubst inserts the configured prefix into Nginx locations/regexes.
case "${BASE_PATH:-}" in
    /*) ;;
    *) echo 'BASE_PATH must start with /' >&2; exit 1 ;;
esac
case "$BASE_PATH" in
    *[!a-zA-Z0-9_/-]*|*/|*//*)
        echo 'BASE_PATH must use /name segments without a trailing slash' >&2
        exit 1
        ;;
esac

exec /docker-entrypoint.sh "$@"
