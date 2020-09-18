/// <reference path="../support/index.d.ts" />

// import {
//   cleanEnv,
//   TENANT_ID,
//   TENANT_CLIENT_ID,
//   TENANT_CLIENT_SECRET,
//   KEYCLOAK_ADMIN_PASSWORD,
//   KEYCLOAK_ADDRESS,
//   KEYCLOAK_CLIENT_ID,
//   KEYCLOAK_CLIENT_SECRET,
//   TEAM_USER,
//   TEAM_USER_PASSWORD
// } from '../../validators'

/**
 * @type {Cypress.PluginConfig}
 */
module.exports = (on, config) => {
  console.log(config) // see what all is in here!
  console.log(Cypress.env()) // see what all is in here!

// const env = cleanEnv({
//   TENANT_ID,
//   TENANT_CLIENT_ID,
//   TENANT_CLIENT_SECRET,
//   KEYCLOAK_ADMIN_PASSWORD,
//   KEYCLOAK_ADDRESS,
//   KEYCLOAK_CLIENT_ID,
//   KEYCLOAK_CLIENT_SECRET,
//   TEAM_USER,
//   TEAM_USER_PASSWORD
// })


  // attach to debugger
  on('before:browser:launch', (browser, args) => {
    if (config.env.NODE_ENV === "test" && browser.name === 'chrome') {
      args.push('--remote-debugging-port=4321')
      return args
    }
  })
  
  // add X-FRAMWE extension
  on("before:browser:launch", (browser, args) => {
    if (browser.name === "chrome") {
      args.push("--disable-features=CrossSiteDocumentBlockingIfIsolating,CrossSiteDocumentBlockingAlways,IsolateOrigins,site-per-process");
      args.push("--load-extension=./src/cypress/extensions/Ignore-X-Frame-headers_v1.1");
      return args;
    }
  })

  return config
}

export {
  // Use an empty export to please Babel's single file emit.
  // https://github.com/Microsoft/TypeScript/issues/15230
}
