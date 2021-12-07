# Otomi Tasks

Part of [Red Kubes](https://redkubes.com)' Otomi Container Platform.

The tasks repo contains autonomous jobs orchestrated by [redkubes/otomi-core](https://github.com/redkubes/otomi-core).

This repo is also built as an image and published on [docker hub](https://hub.docker.com/repository/docker/otomi/tasks) at `otomi/tasks`.

This readme is aimed at development. If you wish to contribute please read our Developers [Contributor Code of Conduct](./docs/CODE_OF_CONDUCT.md) and [Contribution Guidelines](./docs/CONTRIBUTING.md)

## Development

Make sure your expected environment variables exist in a mandatory `.env` file (see `.env.sample`). 

Then start a proxy to the api you wish to target:

- drone: `k -n team-admin port-forward svc/drone 8081:80 &`
- gitea: `k -n gitea port-forward svc/gitea-http 8082:3000 &`
- harbor: `k -n harbor port-forward svc/harbor-harbor-core 8083:80 &`
- keycloak: `k -n keycloak port-forward svc/keycloak-http 8084:80 &`

Or start them all with `bin/start-proxies.sh`

Now you can execute a task locally:

```
npm run tasks:(gitea*|harbor|keycloak|certs-aws|...)-dev
```

Or start them in vscode from the debug menu. (Don't forget to add a profile for any new tasks!)

**Testing https with self-signed certs**

When targeting `https://...` services with self-signed certs, also create a `.env.ca` file (just copy `.env.ca.letsencrypt-staging` to `.env.ca` when using `issuer: letsencrypt-staging`), and export it before running tasks:

```bash
export NODE_EXTRA_CA_CERTS='./.env.ca'
```

Or just skip ssl verification altogether with:

```bash
export NODE_TLS_REJECT_UNAUTHORIZED='0'
```

**Setting debug level:**

For all npm packages (that support it) to turn on debug, edit `.env` and uncomment `DEBUG='*'`

To limit scope please read [the debug docs](https://github.com/visionmedia/debug).

## Unit tests

There are not many unit tests, as the tasks are _very_ robust and idempotent. You can run them as always with:

```
npm test
```
