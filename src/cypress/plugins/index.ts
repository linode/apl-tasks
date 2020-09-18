/* eslint-disable @typescript-eslint/triple-slash-reference */
/// <reference path="../support/index.d.ts" />

/**
 * @type {Cypress.PluginConfig}
 */
module.exports = (on, config) => {

  // attach to debugger
  on('before:browser:launch', (browser, args) => {
    if (config.env.NODE_ENV === "test" && browser.name === 'chrome') {
      args.push('--remote-debugging-port=4321')
      return args
    }
  })
  
  return config
}

export {
  // Use an empty export to please Babel's single file emit.
  // https://github.com/Microsoft/TypeScript/issues/15230
}
