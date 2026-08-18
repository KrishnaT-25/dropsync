export type TransferPath = 'direct' | 'relay' | 'storage'

const stats = {
  direct: 0,
  relay: 0,
  storage: 0,
}

export function recordTransfer(path: TransferPath): void {
  stats[path] += 1
}

export function getTransferStats() {
  return {
    direct: stats.direct,
    relay: stats.relay,
    storage: stats.storage,
    total: stats.direct + stats.relay + stats.storage,
  }
}
