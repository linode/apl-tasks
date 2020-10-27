#!/usr/bin/env sh

rm -rf vendors/client >/dev/null
bin/generate-client.sh harbor node
bin/generate-client.sh keycloak node