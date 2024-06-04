export default async function main(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 1000))
  console.debug('GITEA TASK HAS BEEN CANCELLED!')
}

if (typeof require !== 'undefined' && require.main === module) {
  main()
}
