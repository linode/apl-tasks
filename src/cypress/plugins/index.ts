/// <reference path="../support/index.d.ts" />
import { defaultsDeep } from 'lodash'
import {
  cleanEnv,
  IDP_ALIAS,
  KEYCLOAK_ADMIN,
  KEYCLOAK_ADMIN_PASSWORD,
  KEYCLOAK_ADDRESS,
  KEYCLOAK_REALM,
} from '../../validators'

const env = cleanEnv({
  IDP_ALIAS,
  KEYCLOAK_ADMIN,
  KEYCLOAK_ADMIN_PASSWORD,
  KEYCLOAK_ADDRESS,
  KEYCLOAK_REALM,
})

/**
 * @type {Cypress.PluginConfig}
 */
module.exports = (on, config) => {
  config.env.sharedSecret = 'xxx'
  defaultsDeep( config.env, env )
  return config
}
