mod config;
mod emit;
mod objects;
mod roots;
mod support;

use std::{
    env, fs,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result, anyhow, bail, ensure};
use apollo_compiler::Schema;
use config::{ResolverConfig, default_config};
use emit::write_schema;
use objects::write_objects;
use roots::write_roots;
use support::HEADER;

fn main() -> Result<()> {
    let mut arguments = env::args_os().skip(1);
    let (Some(schema_dir), Some(output_file), None) = (arguments.next(), arguments.next(), arguments.next()) else {
        bail!("usage: graphql-gen <schema-dir> <output-file>");
    };

    let output_file = PathBuf::from(output_file);
    let generated_dir = output_file
        .parent()
        .map(|parent| parent.join("generated"))
        .context("output file has no parent directory")?;
    fs::create_dir_all(&generated_dir).with_context(|| format!("create {}", generated_dir.display()))?;

    let schema = read_schema(Path::new(&schema_dir))?;
    let generated = generate_outputs(&schema, &default_config()?)?;
    fs::write(&output_file, generated.schema).with_context(|| format!("write {}", output_file.display()))?;
    let objects = generated_dir.join("objects.rs");
    fs::write(&objects, generated.objects).with_context(|| format!("write {}", objects.display()))?;
    let roots = generated_dir.join("roots.rs");
    fs::write(&roots, generated.roots).with_context(|| format!("write {}", roots.display()))?;
    Ok(())
}

fn read_schema(schema_dir: &Path) -> Result<String> {
    let mut paths = fs::read_dir(schema_dir)
        .with_context(|| format!("read {}", schema_dir.display()))?
        .map(|entry| entry.map(|entry| entry.path()))
        .collect::<std::io::Result<Vec<PathBuf>>>()?;
    paths.retain(|path| path.extension().is_some_and(|extension| extension == "graphql"));
    paths.sort();
    ensure!(!paths.is_empty(), "no .graphql files in {}", schema_dir.display());

    paths
        .into_iter()
        .map(|path| fs::read_to_string(&path).with_context(|| format!("read {}", path.display())))
        .collect::<Result<Vec<_>>>()
        .map(|schemas| schemas.join("\n"))
}

#[cfg(test)]
fn generate_schema(schema: &str) -> Result<String> {
    let schema = Schema::parse_and_validate(schema, "schema.graphql").map_err(|errors| anyhow!("{errors}"))?;
    let mut output = HEADER.to_owned();
    write_schema(&mut output, &schema)?;
    Ok(output)
}

#[derive(Debug)]
struct GeneratedOutputs {
    schema: String,
    objects: String,
    roots: String,
}

fn generate_outputs(source: &str, resolvers: &ResolverConfig) -> Result<GeneratedOutputs> {
    let schema = Schema::parse_and_validate(source, "schema.graphql").map_err(|errors| anyhow!("{errors}"))?;
    resolvers.validate(&schema)?;

    let mut generated = HEADER.to_owned();
    write_schema(&mut generated, &schema)?;
    let mut objects = HEADER.to_owned();
    write_objects(&mut objects, &schema, resolvers)?;
    let mut roots = HEADER.to_owned();
    write_roots(&mut roots, &schema, resolvers)?;
    Ok(GeneratedOutputs {
        schema: generated,
        objects,
        roots,
    })
}

#[cfg(test)]
mod tests;
