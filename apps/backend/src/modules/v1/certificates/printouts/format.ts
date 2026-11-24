/**
 * Integer centavos as pesos for a printout, e.g. 150050 becomes
 * "PHP 1,500.50". Written as PHP because the PDF's built-in Helvetica has no
 * peso sign. Money is always integer centavos until the moment it is printed.
 */
export function formatPesos(centavos: number): string {
	const sign = centavos < 0 ? "-" : ""
	const absolute = Math.abs(Math.trunc(centavos))
	const pesos = Math.floor(absolute / 100)
	const cents = String(absolute % 100).padStart(2, "0")
	return `${sign}PHP ${pesos.toLocaleString("en-US")}.${cents}`
}
