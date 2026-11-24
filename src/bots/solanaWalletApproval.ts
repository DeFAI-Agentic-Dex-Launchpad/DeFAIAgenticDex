import type { PreparedSniperOrder } from './solanaSniperExecution'

export type WalletApprovalStatus =
  | 'requested'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'revoked'

export type WalletApprovalRequest = {
  approvalId: string
  orderId: string
  walletPublicKey: string
  transactionBase64: string
  expiresAtMs: number
  status: WalletApprovalStatus
  createdAtMs: number
}

export type ApprovedWalletHandoff = WalletApprovalRequest & {
  status: 'approved'
  approvedAtMs: number
}

export type WalletApprovalResult =
  | { ok: true; request: WalletApprovalRequest }
  | { ok: false; code: WalletApprovalErrorCode; detail: string }

export type WalletApprovalErrorCode =
  | 'DUPLICATE_APPROVAL'
  | 'INVALID_EXPIRY'
  | 'APPROVAL_NOT_FOUND'
  | 'APPROVAL_EXPIRED'
  | 'WALLET_MISMATCH'
  | 'INVALID_STATUS'

/**
 * Tracks explicit user approval without handling keys or signing. The caller
 * must still pass the approved transaction to the connected wallet UI.
 */
export class SolanaWalletApprovalManager {
  private readonly requests = new Map<string, WalletApprovalRequest>()

  request(
    order: PreparedSniperOrder,
    options: { approvalId: string; nowMs: number; ttlMs: number },
  ): WalletApprovalResult {
    if (this.requests.has(options.approvalId)) {
      return fail('DUPLICATE_APPROVAL', 'Approval id is already in use.')
    }
    if (!Number.isFinite(options.ttlMs) || options.ttlMs <= 0) {
      return fail('INVALID_EXPIRY', 'Wallet approval TTL must be positive.')
    }

    const request: WalletApprovalRequest = {
      approvalId: options.approvalId,
      orderId: order.orderId,
      walletPublicKey: order.walletPublicKey,
      transactionBase64: order.transactionBase64,
      expiresAtMs: options.nowMs + options.ttlMs,
      status: 'requested',
      createdAtMs: options.nowMs,
    }
    this.requests.set(request.approvalId, request)
    return { ok: true, request }
  }

  approve(
    approvalId: string,
    walletPublicKey: string,
    nowMs: number,
  ): WalletApprovalResult & { ok: true; request: ApprovedWalletHandoff } {
    const request = this.requests.get(approvalId)
    if (!request) return fail('APPROVAL_NOT_FOUND', 'Approval request was not found.') as never
    if (request.status !== 'requested') {
      return fail('INVALID_STATUS', `Approval is already ${request.status}.`) as never
    }
    if (nowMs >= request.expiresAtMs) {
      request.status = 'expired'
      return fail('APPROVAL_EXPIRED', 'Wallet approval request has expired.') as never
    }
    if (walletPublicKey !== request.walletPublicKey) {
      return fail('WALLET_MISMATCH', 'Connected wallet does not match the prepared order.') as never
    }

    const approved: ApprovedWalletHandoff = {
      ...request,
      status: 'approved',
      approvedAtMs: nowMs,
    }
    this.requests.set(approvalId, approved)
    return { ok: true, request: approved }
  }

  reject(approvalId: string): WalletApprovalResult {
    const request = this.requests.get(approvalId)
    if (!request) return fail('APPROVAL_NOT_FOUND', 'Approval request was not found.')
    if (request.status !== 'requested') {
      return fail('INVALID_STATUS', `Approval is already ${request.status}.`)
    }
    request.status = 'rejected'
    return { ok: true, request }
  }

  revoke(approvalId: string): WalletApprovalResult {
    const request = this.requests.get(approvalId)
    if (!request) return fail('APPROVAL_NOT_FOUND', 'Approval request was not found.')
    if (request.status !== 'approved') {
      return fail('INVALID_STATUS', `Only approved requests can be revoked; current status is ${request.status}.`)
    }
    request.status = 'revoked'
    return { ok: true, request }
  }

  get(approvalId: string, nowMs?: number): WalletApprovalRequest | undefined {
    const request = this.requests.get(approvalId)
    if (request && nowMs !== undefined && request.status === 'requested' && nowMs >= request.expiresAtMs) {
      request.status = 'expired'
    }
    return request
  }

  clear() {
    this.requests.clear()
  }
}

function fail(
  code: WalletApprovalErrorCode,
  detail: string,
): { ok: false; code: WalletApprovalErrorCode; detail: string } {
  return { ok: false, code, detail }
}
