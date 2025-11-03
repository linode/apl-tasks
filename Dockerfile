# --------------- Dev stage for developers to override sources
FROM node:22-alpine AS dev

RUN apk --no-cache add make gcc g++ python3 git jq

ENV NODE_ENV=development
ENV BLUEBIRD_DEBUG=0

RUN mkdir /app
WORKDIR /app

COPY package*.json ./
RUN echo "@linode:registry=https://npm.pkg.github.com/linode" > .npmrc
RUN --mount=type=secret,id=NPM_TOKEN \
    echo "//npm.pkg.github.com/:_authToken=$(cat /tmp/npm_token)" >> .npmrc

RUN npm ci

# --------------- ci stage for CI runner
FROM dev AS ci

COPY . eslint.config.mjs ./

ARG SKIP_TESTS='false'
ARG CI=true
ENV NODE_ENV=test

RUN if [ "$SKIP_TESTS" = 'false' ]; then npm run lint && npm run test; fi
RUN npm run build

# --------------- Cleanup
FROM dev AS clean
# below command removes the packages specified in devDependencies and set NODE_ENV to production
RUN npm prune --production
# --------------- Production stage
FROM node:22.13.1-alpine AS prod

COPY --from=dev /usr/local/bin/node /usr/bin/
COPY --from=dev /usr/lib/libgcc* /usr/lib/
COPY --from=dev /usr/lib/libstdc* /usr/lib/

# Install dependencies
RUN apk add --no-cache git

# Install app
RUN mkdir /app
WORKDIR /app
COPY --from=clean /app/node_modules node_modules
COPY --from=ci /app/dist dist
COPY package.json .

USER node
ENV NODE_ENV=production
# suppress npm update check 
ENV npm_config_update_notifier=false
# suppress npm warnings
ENV NODE_NO_WARNINGS='1'
