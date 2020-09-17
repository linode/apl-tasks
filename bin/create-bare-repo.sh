#!/bin/bash
set -e

# This script clones original repository and stubs its remote origin
# Use for testing purpose to not depend on any remote repository

WORKSPACE="/tmp/otomi-values-repo"
REPO='otomi-values-demo'
REPO_PATH="${WORKSPACE}/$REPO"
BARE_REPO="$REPO-bare"
BARE_REPO_PATH="${WORKSPACE}/$BARE_REPO"

mkdir -p $REPO_PATH
cd $WORKSPACE

git init --bare $BARE_REPO

git clone git@github.com:redkubes/otomi-values-demo.git
cd $REPO_PATH
echo "Current remote origin for $REPO repository"
git remote -v
echo "Overwritting remote origin for $REPO repository"
git remote set-url origin file://${BARE_REPO_PATH}
git remote -v
echo "Updateing bare repo"
git push

echo "Local repo at: $REPO_PATH"
echo "Remote repo at: $BARE_REPO_PATH"
echo "Success"
