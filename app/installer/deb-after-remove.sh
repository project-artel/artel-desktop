#!/bin/sh
# Removes the link only when it still points into this package.
if [ "$(readlink /usr/bin/artel 2>/dev/null)" = "/opt/ARTEL/resources/bin/artel" ]; then
  rm -f /usr/bin/artel
fi
