export const AutolinkFlow = () => {
  return {
    authenticationFlows: [
      {
        alias: 'Autolink first broker login',
        description:
          'Actions taken after first broker login with identity provider account, which is not yet linked to any Keycloak account',
        providerId: 'basic-flow',
        topLevel: true,
        builtIn: false,
        authenticationExecutions: [
          {
            authenticatorConfig: 'review profile config',
            authenticator: 'idp-review-profile',
            requirement: 'REQUIRED',
            priority: 10,
            userSetupAllowed: true,
            autheticatorFlow: false,
          },
          {
            requirement: 'REQUIRED',
            priority: 20,
            flowAlias: 'Autolink first broker login User creation or linking',
            userSetupAllowed: true,
            autheticatorFlow: true,
          },
        ],
      },
      {
        alias: 'Autolink first broker login Handle Existing Account',
        description:
          'Handle what to do if there is existing account with same email/username like authenticated identity provider',
        providerId: 'basic-flow',
        topLevel: false,
        builtIn: false,
        authenticationExecutions: [
          {
            authenticator: 'idp-auto-link',
            requirement: 'ALTERNATIVE',
            priority: 20,
            userSetupAllowed: false,
            autheticatorFlow: false,
          },
          {
            authenticator: 'idp-confirm-link',
            requirement: 'ALTERNATIVE',
            priority: 21,
            userSetupAllowed: false,
            autheticatorFlow: false,
          },
        ],
      },
      {
        alias: 'Autolink first broker login User creation or linking',
        description: 'Flow for the existing/non-existing user alternatives',
        providerId: 'basic-flow',
        topLevel: false,
        builtIn: false,
        authenticationExecutions: [
          {
            authenticatorConfig: 'create unique user config',
            authenticator: 'idp-create-user-if-unique',
            requirement: 'ALTERNATIVE',
            priority: 10,
            userSetupAllowed: false,
            autheticatorFlow: false,
          },
          {
            requirement: 'ALTERNATIVE',
            priority: 20,
            flowAlias: 'Autolink first broker login Handle Existing Account',
            userSetupAllowed: false,
            autheticatorFlow: true,
          },
        ],
      },
    ],
  }
}
