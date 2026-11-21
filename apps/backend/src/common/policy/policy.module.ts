import { Global, Module } from "@nestjs/common"

import { PolicyService } from "./policy.service"

/**
 * Booking, payment and sign-in Policies (ADM-6).
 *
 * Global because the rules are read across epics (booking, payments, auth),
 * and every reader must go through {@link PolicyService} rather than the
 * `policies` table (DOMAIN-MODEL section 6).
 */
@Global()
@Module({
	providers: [PolicyService],
	exports: [PolicyService],
})
export class PolicyModule {}
