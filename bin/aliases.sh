alias d="docker"
alias k="kubectl"
alias ksk="k -n kube-system"
alias ki="k -n ingress"
alias kh="k -n harbor"
alias kis="k -n istio-system"
alias ks="k -n system"
alias ksh="k -n shared"
alias km="k -n monitoring"
alias kta="k -n team-admin"
alias ka="k --all-namespaces=true"
alias kaa="ka get po,rs,job,deploy,ds,statefulset,svc"
alias kap="ka get po"
alias kdel="k delete"
alias kcv="k config view"
alias kce="$EDITOR ~/.kube/config"
alias kcg="k config view | grep 'current-context:' | sed -n -e 's/^.*current-context: //p'"
alias kcu="k config use-context"
alias kp="k proxy &"
alias kp="killall kubectl"

function h() { helm $@; }

function drun() {
  docker run --rm -v $PWD:/tmp/sh -w /tmp/sh busybox sh -c ". bin/aliases.sh && $@"
}

function update_openapi_version() {
  PACKAGE_VERSION=$(cat package.json | grep '"version"' | head -1 | awk -F: '{ print $2 }' | sed 's/[",]//g' | tr -d '[[:space:]]')
  sed -ri "s/^(\s*)version\s*:\s(.*)$/\1version: $PACKAGE_VERSION/" src/openapi/api.yaml
}

function release_otomi() {
  rm -rf vendors/client/otomi-api/axios >/dev/null
  npm run build:client:otomi
  cd vendors/client/otomi-api/axios
  npm publish
  cd -
}
