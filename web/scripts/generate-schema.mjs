import { buildSchema, introspectionFromSchema } from 'graphql'
import { readFileSync, readdirSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'

const schemaDir = resolve(import.meta.dirname, '../../schema')
const outFile = resolve(import.meta.dirname, '../src/graphql/schema.json')

const sourceFiles = readdirSync(schemaDir)
  .filter((f) => f.endsWith('.graphql'))
  .sort()
  .map((f) => join(schemaDir, f))

const sdl = sourceFiles.map((f) => readFileSync(f, 'utf8')).join('\n')
const schema = buildSchema(sdl)
const introspection = introspectionFromSchema(schema)
const output = JSON.stringify(introspection, null, 2)
const existing = (() => { try { return readFileSync(outFile, 'utf8') } catch { return null } })()

if (existing === output) {
  console.log('schema.json is up to date')
  process.exit(0)
}

writeFileSync(outFile, output)
console.log(`schema.json written to ${outFile}`)
