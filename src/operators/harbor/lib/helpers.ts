export function alreadyExistsError(e): boolean {
  if (e && e.body && e.body.errors && e.body.errors.length > 0) {
    return e.body.errors[0].message.includes('already exists')
  }
  return false
}
