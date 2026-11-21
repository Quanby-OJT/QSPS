import { Module } from "@nestjs/common"

import { AuditModule } from "@/common/audit/audit.module"
import { RbacModule } from "@/common/rbac/rbac.module"

import { ScopeService } from "./scope.service"
import { SCOPE_RESOLVER } from "./scope.token"

/** ADM-2: import this in any module whose staff-facing endpoints are limited by Scope. */
@Module({
	imports: [AuditModule, RbacModule],
	providers: [ScopeService, { provide: SCOPE_RESOLVER, useExisting: ScopeService }],
	exports: [ScopeService, SCOPE_RESOLVER],
})
export class ScopeModule {}
