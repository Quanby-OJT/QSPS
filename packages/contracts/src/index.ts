/**
 * @repo/contracts
 * Shared oRPC contracts for type-safe API communication
 */

// Export version contracts and types
export * from "./contracts.js"
export * from "./modules/v1/rbac/rbac.schema.js"

// Re-export useful types from @orpc packages for convenience
export type { ContractRouter } from "@orpc/contract"
