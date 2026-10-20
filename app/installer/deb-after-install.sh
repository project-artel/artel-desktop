#!/bin/sh
# Puts `artel` on PATH. The shim resolves symlinks, so it finds its own resources directory.
ln -sf /opt/ARTEL/resources/bin/artel /usr/bin/artel
