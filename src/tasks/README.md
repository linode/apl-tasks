# Overview

The tasks directory contains autonomous jobs that are able to configure core otomi-stack services.

A given task can be executed by running following command:

```
npm run tasks:<task-name>
```

For example:

```
npm run tasks:harbor
```

KeyCloak SSO configuration:

Running the tasks script will bootstrap all the configs for setting up any OIDC Provider.
Expected environment variables need to be sourced from the `.env.dev` file in the local workstation, which can be created from the `.secrets` file, in the company shared drive.

For example:

```
npm run tasks:keycloak
```
