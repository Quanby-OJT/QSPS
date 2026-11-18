import { defineConfig } from "eslint/config"

import { apiConfig } from "@repo/eslint-config/nest"

export default defineConfig(
	{
		ignores: ["eslint.config.mjs", "dist/**", "src/metadata.ts"],
	},
	apiConfig,
	{
		rules: {
			"@typescript-eslint/no-explicit-any": "off",
			"@typescript-eslint/no-floating-promises": "warn",
			"@typescript-eslint/no-unsafe-argument": "warn",
		},
	},
	// PAY-1 boundary: a payment gateway's own code and types stay inside
	// src/modules/v1/payments/providers/<gateway-code>/. Everything else talks
	// to the PaymentProvider interface; only provider-registry.ts wires
	// adapters in. Swapping a gateway must never touch the rest of the system.
	{
		files: ["src/**/*.ts"],
		ignores: [
			"src/modules/v1/payments/providers/*/**",
			"src/modules/v1/payments/providers/provider-registry.ts",
		],
		rules: {
			"no-restricted-imports": [
				"error",
				{
					patterns: [
						{
							regex: "providers/(?!payment-provider(\\.contract-spec)?$|provider-registry$)[^/]+",
							message:
								"Gateway code stays in its own providers/<gateway-code>/ folder. Use the PaymentProvider interface, and register adapters in provider-registry.ts.",
						},
					],
				},
			],
		},
	}
)
