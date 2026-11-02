const pending = new Set<Promise<void>>()
const errors: unknown[] = []

export function trackSocketCleanup(task: Promise<void>): void {
  const tracked = task
    .catch((error: unknown) => {
      errors.push(error)
      console.error('[socket] disconnect cleanup failed', error)
    })
    .finally(() => {
      pending.delete(tracked)
    })
  pending.add(tracked)
}

export async function waitForSocketCleanups(): Promise<void> {
  while (pending.size > 0) {
    await Promise.all(pending)
  }
  if (errors.length > 0) {
    throw new AggregateError(errors.splice(0), 'Socket disconnect cleanup failed')
  }
}
