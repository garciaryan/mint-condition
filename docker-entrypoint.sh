#!/bin/sh
set -e
mkdir -p "${DATA_DIR:-/data}"
chown node:node "${DATA_DIR:-/data}"
exec setpriv --reuid=node --regid=node --init-groups "$@"
