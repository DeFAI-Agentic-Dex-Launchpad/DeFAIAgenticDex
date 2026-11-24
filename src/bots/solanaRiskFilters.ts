export type AuthorityStatus = 'revoked' | 'present' | 'unknown'
export type SimulationStatus = 'pass' | 'fail' | 'unknown'

export type SolanaTokenRiskInput = {
  mint: string
  mintAuthority: AuthorityStatus
  freezeAuthority: AuthorityStatus
  liquidityUsd: number | null
  liquidityLocked: boolean | null
  topHolderPct: number | null
  holderConcentrationPct: number | null
  tokenAgeSeconds: number | null
  simulation: SimulationStatus
  isDenylisted?: boolean
}

export type SolanaRiskConfig = {
  minLiquidityUsd: number
  requireLiquidityLocked: boolean
  maxTopHolderPct: number
  maxHolderConcentrationPct: number
  minTokenAgeSeconds: number
  maxTokenAgeSeconds: number
  rejectMintAuthority: boolean
  rejectFreezeAuthority: boolean
  requireSimulationPass: boolean
}

export type SolanaRiskReasonCode =
  | 'DENYLISTED'
  | 'MINT_AUTHORITY_PRESENT'
  | 'FREEZE_AUTHORITY_PRESENT'
  | 'MINT_AUTHORITY_UNKNOWN'
  | 'FREEZE_AUTHORITY_UNKNOWN'
  | 'LIQUIDITY_MISSING'
  | 'LIQUIDITY_TOO_LOW'
  | 'LIQUIDITY_NOT_LOCKED'
  | 'TOP_HOLDER_DATA_MISSING'
  | 'TOP_HOLDER_TOO_CONCENTRATED'
  | 'HOLDER_DATA_MISSING'
  | 'HOLDERS_TOO_CONCENTRATED'
  | 'TOKEN_AGE_UNKNOWN'
  | 'TOKEN_TOO_NEW'
  | 'TOKEN_TOO_OLD'
  | 'SIMULATION_FAILED'
  | 'SIMULATION_UNKNOWN'

export type SolanaRiskCheck = {
  code: SolanaRiskReasonCode
  passed: boolean
  detail: string
}

export type SolanaRiskDecision = {
  approved: boolean
  checks: readonly SolanaRiskCheck[]
  rejectionCodes: readonly SolanaRiskReasonCode[]
}

export const DEFAULT_SOLANA_RISK_CONFIG: SolanaRiskConfig = {
  minLiquidityUsd: 10_000,
  requireLiquidityLocked: true,
  maxTopHolderPct: 15,
  maxHolderConcentrationPct: 35,
  minTokenAgeSeconds: 0,
  maxTokenAgeSeconds: 86_400,
  rejectMintAuthority: true,
  rejectFreezeAuthority: true,
  requireSimulationPass: true,
}

function check(
  code: SolanaRiskReasonCode,
  passed: boolean,
  detail: string,
): SolanaRiskCheck {
  return { code, passed, detail }
}

export function evaluateSolanaTokenRisk(
  input: SolanaTokenRiskInput,
  config: SolanaRiskConfig = DEFAULT_SOLANA_RISK_CONFIG,
): SolanaRiskDecision {
  const checks: SolanaRiskCheck[] = []
  const add = (value: SolanaRiskCheck) => checks.push(value)

  if (input.isDenylisted) {
    add(check('DENYLISTED', false, 'Token is present on the denylist.'))
  }

  if (config.rejectMintAuthority) {
    add(
      check(
        input.mintAuthority === 'revoked'
          ? 'MINT_AUTHORITY_PRESENT'
          : input.mintAuthority === 'unknown'
            ? 'MINT_AUTHORITY_UNKNOWN'
            : 'MINT_AUTHORITY_PRESENT',
        input.mintAuthority === 'revoked',
        input.mintAuthority === 'revoked'
          ? 'Mint authority is revoked.'
          : 'Mint authority is present or could not be verified.',
      ),
    )
  }

  if (config.rejectFreezeAuthority) {
    add(
      check(
        input.freezeAuthority === 'revoked'
          ? 'FREEZE_AUTHORITY_PRESENT'
          : input.freezeAuthority === 'unknown'
            ? 'FREEZE_AUTHORITY_UNKNOWN'
            : 'FREEZE_AUTHORITY_PRESENT',
        input.freezeAuthority === 'revoked',
        input.freezeAuthority === 'revoked'
          ? 'Freeze authority is revoked.'
          : 'Freeze authority is present or could not be verified.',
      ),
    )
  }

  add(
    check(
      input.liquidityUsd !== null ? 'LIQUIDITY_TOO_LOW' : 'LIQUIDITY_MISSING',
      input.liquidityUsd !== null &&
        Number.isFinite(input.liquidityUsd) &&
        input.liquidityUsd >= config.minLiquidityUsd,
      input.liquidityUsd === null
        ? 'Liquidity amount is unavailable.'
        : `Liquidity is $${input.liquidityUsd.toFixed(2)}; minimum is $${config.minLiquidityUsd.toFixed(2)}.`,
    ),
  )

  if (config.requireLiquidityLocked) {
    add(
      check(
        'LIQUIDITY_NOT_LOCKED',
        input.liquidityLocked === true,
        input.liquidityLocked === true
          ? 'Liquidity lock is verified.'
          : 'Liquidity lock is missing or could not be verified.',
      ),
    )
  }

  add(
    check(
      input.topHolderPct === null
        ? 'TOP_HOLDER_DATA_MISSING'
        : 'TOP_HOLDER_TOO_CONCENTRATED',
      input.topHolderPct !== null &&
        Number.isFinite(input.topHolderPct) &&
        input.topHolderPct <= config.maxTopHolderPct,
      input.topHolderPct === null
        ? 'Top-holder concentration is unavailable.'
        : `Top holder owns ${input.topHolderPct.toFixed(2)}%; maximum is ${config.maxTopHolderPct.toFixed(2)}%.`,
    ),
  )

  add(
    check(
      input.holderConcentrationPct === null
        ? 'HOLDER_DATA_MISSING'
        : 'HOLDERS_TOO_CONCENTRATED',
      input.holderConcentrationPct !== null &&
        Number.isFinite(input.holderConcentrationPct) &&
        input.holderConcentrationPct <= config.maxHolderConcentrationPct,
      input.holderConcentrationPct === null
        ? 'Holder concentration is unavailable.'
        : `Top holders own ${input.holderConcentrationPct.toFixed(2)}%; maximum is ${config.maxHolderConcentrationPct.toFixed(2)}%.`,
    ),
  )

  add(
    check(
      input.tokenAgeSeconds === null
        ? 'TOKEN_AGE_UNKNOWN'
        : 'TOKEN_TOO_NEW',
      input.tokenAgeSeconds !== null &&
        Number.isFinite(input.tokenAgeSeconds) &&
        input.tokenAgeSeconds >= config.minTokenAgeSeconds,
      input.tokenAgeSeconds === null
        ? 'Token age is unavailable.'
        : `Token age is ${input.tokenAgeSeconds}s; minimum is ${config.minTokenAgeSeconds}s.`,
    ),
  )

  if (input.tokenAgeSeconds !== null) {
    add(
      check(
        'TOKEN_TOO_OLD',
        input.tokenAgeSeconds <= config.maxTokenAgeSeconds,
        `Token age is ${input.tokenAgeSeconds}s; maximum is ${config.maxTokenAgeSeconds}s.`,
      ),
    )
  }

  if (config.requireSimulationPass) {
    add(
      check(
        input.simulation === 'fail'
          ? 'SIMULATION_FAILED'
          : 'SIMULATION_UNKNOWN',
        input.simulation === 'pass',
        input.simulation === 'pass'
          ? 'Swap simulation passed.'
          : 'Swap simulation failed or is unavailable.',
      ),
    )
  }

  const rejectionCodes = checks.filter((item) => !item.passed).map((item) => item.code)
  return {
    approved: rejectionCodes.length === 0,
    checks,
    rejectionCodes,
  }
}
