# --------------- Dev stage for developers to override sources
FROM node:15-alpine as dev
ARG NPM_TOKEN
RUN test -n "$NPM_TOKEN"

RUN apk --no-cache add make gcc g++ python3 git jq

ENV NODE_ENV=development
ENV BLUEBIRD_DEBUG=0

RUN mkdir /app
WORKDIR /app

COPY package*.json ./
COPY .npmrc ./
RUN echo "//npm.pkg.github.com/:_authToken=${NPM_TOKEN}" >> .npmrc

RUN npm ci

# --------------- ci stage for CI runner
FROM dev as ci

COPY . .eslintrc.yml ./

ARG SKIP_TESTS='false'
ARG CI=true
ENV NODE_ENV=test

RUN if [ "$SKIP_TESTS" = 'false' ]; then npm run lint && npm run test; fi
RUN npm run build

# --------------- Cleanup
FROM dev as clean
# below command removes the packages specified in devDependencies and set NODE_ENV to production
RUN npm prune --production
# --------------- Production stage
FROM node:15-alpine AS prod

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
