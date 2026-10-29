// Bütün parçaları Shopify Theme Check ile denetler; bulgu varsa 1 ile çıkar.
import { check } from '@shopify/theme-check-node'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const offenses = await check(root)
const SEVERITY = ['hata', 'uyarı', 'bilgi']
for (const offense of offenses) {
  const file = offense.uri.slice(offense.uri.lastIndexOf('/', offense.uri.lastIndexOf('/') - 1) + 1)
  console.log(`${SEVERITY[offense.severity] ?? offense.severity}  ${file}:${offense.start.line + 1}  ${offense.check}  ${offense.message}`)
}
console.log(offenses.length ? `${offenses.length} bulgu.` : 'Theme Check: bulgu yok.')
process.exit(offenses.length ? 1 : 0)
