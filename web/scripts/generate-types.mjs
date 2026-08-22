import { codegen } from '@graphql-codegen/core'
import * as typescriptPlugin from '@graphql-codegen/typescript'
import { buildSchema, parse, printSchema } from 'graphql'
import { readFileSync, readdirSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'

const schemaDir = resolve(import.meta.dirname, '../../schema')
const outFile = process.argv[2]
  ? resolve(process.cwd(), process.argv[2])
  : resolve(import.meta.dirname, '../src/types/graphql.ts')

const sdl = readdirSync(schemaDir)
  .filter((f) => f.endsWith('.graphql'))
  .sort()
  .map((f) => readFileSync(join(schemaDir, f), 'utf8'))
  .join('\n')

const schema = buildSchema(sdl)

// Match the conventions the frontend already relies on:
// - enums as string-union types (no runtime enum objects, keeps the file type-only)
// - custom Date/DateTime scalars are ISO strings
// - keep optional `__typename` literals for discriminated-union narrowing
// - object/input types as interfaces; nullable fields as `?: T | null`
const body = await codegen({
  filename: outFile,
  schema: parse(printSchema(schema)),
  documents: [],
  config: {
    enumsAsTypes: true,
    declarationKind: 'interface',
    namingConvention: 'keep',
    scalars: { Date: 'string', DateTime: 'string', Money: 'number' },
  },
  plugins: [{ typescript: {} }],
  pluginMap: { typescript: typescriptPlugin },
})

const header = '// AUTO-GENERATED from ../schema/*.graphql by scripts/generate-types.mjs.\n// Do not edit by hand — run `npm run generate:types` instead.\n\n'
const output = header + body

const existing = (() => {
  try {
    return readFileSync(outFile, 'utf8')
  } catch {
    return null
  }
})()

if (existing === output) {
  console.log('graphql.ts types are up to date')
  process.exit(0)
}

writeFileSync(outFile, output)
console.log(`graphql types written to ${outFile}`)
