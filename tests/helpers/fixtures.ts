/** A small vulnerable Node app used by the scan tests. */
export const SHOP_FILES: Record<string, string> = {
  'README.md': '# Shop\nA tiny storefront with an admin panel.\n',
  'package.json': JSON.stringify({ name: 'shop', dependencies: { express: '4.17.1' } }, null, 2),
  'package-lock.json': JSON.stringify(
    {
      name: 'shop',
      lockfileVersion: 3,
      packages: {
        '': { name: 'shop' },
        'node_modules/express': { version: '4.17.1' },
        'node_modules/lodash': { version: '4.17.15' },
      },
    },
    null,
    2,
  ),
  'src/server.ts': [
    "import express from 'express'",
    'const app = express()',
    "app.get('/search', (req, res) => db.query(\"SELECT * FROM products WHERE name = '\" + req.query.q + \"'\"))",
    "app.get('/calc', (req, res) => res.send(String(eval(req.query.expr))))",
    'app.listen(3000)',
  ].join('\n'),
  'src/auth.ts': ['export const API_KEY = "sk_live_abcdefghijklmnop1234"', 'export function login() {}'].join('\n'),
}

export const LODASH_VULN = { 'lodash@4.17.15': { id: 'GHSA-p6mc-m468-83gw', summary: 'Prototype pollution in lodash', severity: 'CRITICAL', fixed: '4.17.19' } }
