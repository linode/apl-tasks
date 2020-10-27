#!/usr/bin/env sh

for each in "harbor/node" "keycloak/node"; do
  pkg=${each%%/*}
  if git --no-pager log -1 --stat --oneline --name-only | grep "vendors/openapi/$pkg.json" >/dev/null; then
    exit 0
  fi
done
exit 1