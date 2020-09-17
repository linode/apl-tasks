// ***********************************************
// https://on.cypress.io/custom-commands
// ***********************************************

Cypress.Commands.add("azLogin", (fn) => {
    const idp = Cypress.config("idp")
    cy.request({
      method: "POST",
      url: `https://login.microsoftonline.com/${idp.tenantId}/oauth2/token`,
      form: true,
      body: {
        grant_type: idp.grantType,
        client_id: idp.clientId,
        client_secret: idp.clientSecret,
        resource: idp.resource,
        username: idp.username,
        password: idp.password,
      },
    }).then((response) => {
      const access_token = response.body.access_token;
    //   const expiresOn = response.body.expires_on;
      localStorage.setItem("idp_access_token", access_token);
      fn(access_token)
    });
  });

//   %2Foauth2%2Fcallback&response_type=code&scope=openid+email+profile&state=876c1edbef8b45504dc035a693f83645%3A%2F
// redirect_uri=https%3A%2F%2Fauth.demo.gke.otomi.cloud  
// ?approval_prompt=force&client_id=otomi& 

// Refused to display 'https://login.microsoftonline.com/57a3f6ea-7e70-4260-acb4-e06ce452f695/oauth2/v2.0/authorize?scope=openid+email+profile&state=-zBpFiMGApKrg4GJRMdm53tDmSmuYDpu5Jro45ffvgg._aq9thEMeyE.otomi&response_type=code&client_id=5eb129f2-1b26-4910-a05a-70d8b6a380cd&redirect_uri=https%3A%2F%2Fkeycloak.demo.gke.otomi.cloud%2Frealms%2Fmaster%2Fbroker%2Fredkubes-azure%2Fendpoint&nonce=QZ2EHY_FeLjpZMHfVUswPQ' in a frame because it set 'X-Frame-Options' to 'deny'.
Cypress.Commands.add("kcLogin", (fn) => {
    const keycloak = Cypress.config("keycloak")
    cy.request({
      method: "POST",
      url: `https://keycloak.demo.gke.otomi.cloud/realms/master/protocol/openid-connect/token`,
      form: true,
      body: {
        grant_type: keycloak.grantType,
        client_id: keycloak.clientId,
        client_secret: keycloak.clientSecret,
        scope: keycloak.scope,
        username: keycloak.username,
        password: keycloak.password,
      },
    }).then((response) => {
        const access_token = response.body.access_token;
        // const expiresOn = response.body.expires_on;
        localStorage.setItem("kc_access_token", access_token);
        fn(access_token)
    });
  });