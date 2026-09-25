import { ClientRepresentation } from '@linode/keycloak-client-node'
import { findManagedClient } from './realm-factory'

const client = (fields: Partial<ClientRepresentation>): ClientRepresentation => fields as ClientRepresentation

describe('findManagedClient', () => {
  it('finds the managed client by its pinned id', () => {
    const all = [client({ id: 'account', name: '${client_account}' }), client({ id: 'otomi' })]
    expect(findManagedClient(all)?.id).toBe('otomi')
  })

  it('finds the managed client by clientId when its internal id is a generated uuid', () => {
    // A realm where the client was not created with the id pinned by
    // otomiClientCfgTpl still has to resolve, or the caller falls to its create
    // branch and POSTs a clientId that is already taken.
    const all = [client({ id: '9f1c-uuid', clientId: 'otomi' })]
    expect(findManagedClient(all)?.id).toBe('9f1c-uuid')
  })

  it('does not match an unrelated client that happens to have no name', () => {
    // The regression this replaces: the old lookup was `el.name === client.name`
    // with client.name undefined, i.e. "the first client with no name". A nameless
    // public client sorting earlier captured it, and the operator then PUT
    // authorizationServicesEnabled onto it -- Keycloak 500s, the realm reconcile
    // aborts before manageUsers, and APL console users are never created.
    const all = [client({ id: 'llz', clientId: 'llz', publicClient: true }), client({ id: 'otomi' })]
    expect(findManagedClient(all)?.id).toBe('otomi')
  })

  it('is not confused by several nameless clients', () => {
    const all = [
      client({ id: 'aaa', clientId: 'aaa' }),
      client({ id: 'llz-smoke-171', clientId: 'llz-smoke-171' }),
      client({ id: 'otomi' }),
      client({ id: 'zzz', clientId: 'zzz' }),
    ]
    expect(findManagedClient(all)?.id).toBe('otomi')
  })

  it('returns undefined when the managed client is absent, so the caller creates it', () => {
    expect(findManagedClient([client({ id: 'llz', clientId: 'llz' })])).toBeUndefined()
    expect(findManagedClient([])).toBeUndefined()
  })

  it('accepts an explicit clientId', () => {
    const all = [client({ id: 'otomi' }), client({ id: 'other', clientId: 'other' })]
    expect(findManagedClient(all, 'other')?.id).toBe('other')
  })
})
