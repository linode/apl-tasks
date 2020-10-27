# Otomi Tasks

Part of [Red Kubes](https://redkubes.com)' Otomi Container Platform.

The tasks repo contains autonomous jobs orchestrated by [redkubes/otomi-core](https://github.com/redkubes/otomi-core).

This repo is also built as an image and published on [docker hub](https://hub.docker.com/repository/docker/otomi/tasks) at `otomi/tasks`.

This readme is aimed at development. If you wish to contribute please read our Developers [Contributor Code of Conduct](./docs/CODE_OF_CONDUCT.md) and [Contribution Guidelines](./docs/CONTRIBUTING.md)

## Development

To execute a task:

```
npm run task:(harbor|keycloak|certs-aws|...)
```

Expected environment variables should exist in a mandatory `.env` file (see `.env.sample`).

Run unit tests on the tasks:

```
npm test
```
