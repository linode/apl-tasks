#!/usr/bin/env sh

for each in "harbor/node" "keycloak/node"; do
  pkg=${each%%/*}
  type=${each##*/}
  echo "Checking for newer client: $pkg-$type"
  if git --no-pager log -1 --stat --oneline --name-only | grep "vendors/openapi/$pkg.json" >/dev/null; then
    echo "Publishing newer client: $pkg-$type"
    cd vendors/client/$pkg/$type
    npm publish
    cd -
  fi
done
exit 0