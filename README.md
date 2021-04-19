# Otomi Tasks

Part of [Red Kubes](https://redkubes.com)' Otomi Container Platform.

The tasks repo contains autonomous jobs orchestrated by [redkubes/otomi-core](https://github.com/redkubes/otomi-core).

This repo is also built as an image and published on [docker hub](https://hub.docker.com/repository/docker/otomi/tasks) at `otomi/tasks`.

This readme is aimed at development. If you wish to contribute please read our Developers [Contributor Code of Conduct](./docs/CODE_OF_CONDUCT.md) and [Contribution Guidelines](./docs/CONTRIBUTING.md)

## Development

Make sure your expected environment variables exist in a mandatory `.env` file (see `.env.sample`).
Then start a proxy to the api you wish to target:

- gitea: `k -n gitea port-forward svc/gitea-http 8080:3000` &`
- harbor: `k -n harbor port-forward svc/harbor-harbor-core 8080:80 &`
- keycloak: `k -n keycloak port-forward svc/keycloak-http 8080:80` &`

Now you can execute a task locally: 

```
npm run task:(gitea*|harbor|keycloak|certs-aws|...)-dev
```

Or you can start them in the vscode debugger.

## Unit tests

There are not many unit tests, as the tasks are *very* robust and idempotent. You can run them as always with:

```
npm test
```