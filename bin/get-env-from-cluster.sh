#!/usr/bin/env bash
function k {
  kubectl "$@"
}

function get_configmap {
  name=$1
  k -n maintenance get "$name" -o json | jq -r '.data' | yq e -P
}
function get_secret {
  name=$1
  k -n maintenance get "$name" -o json | jq -r '.data[] |= @base64d| .data' | yq e -P
}



for secretName in $(k -n maintenance get secret -o name | grep 'secret/job')
do
  echo "# $secretName"
  get_secret "$secretName" | sed 's/: /=/'
done

exclude='tmpnode'
for configName in $(k -n maintenance get configmap -o name | grep 'configmap/job' | grep -v $exclude)
do
  echo "# $configName"
  get_configmap "$configName" | sed 's/: /=/'
done