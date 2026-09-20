use std::fmt::Write as _;

use anyhow::{Context, Result, ensure};
use apollo_compiler::Schema;

use crate::{
    config::ResolverConfig,
    support::{write_delegating_method, write_trait_method},
};

pub(crate) fn write_roots(output: &mut String, schema: &Schema, config: &ResolverConfig) -> Result<()> {
    writeln!(output, "use super::{{generated::*, objects::*}};\n").unwrap();
    write_root(output, schema, config, "Query")?;
    write_root(output, schema, config, "Mutation")?;
    Ok(())
}

fn write_root(output: &mut String, schema: &Schema, config: &ResolverConfig, name: &str) -> Result<()> {
    let definition = schema
        .get_object(name)
        .with_context(|| format!("missing {name} root"))?;
    writeln!(output, "pub trait {name}Resolvers {{").unwrap();
    for field in definition.fields.values() {
        write_trait_method(output, name, field, schema)?;
    }
    writeln!(output, "}}\n").unwrap();
    writeln!(output, "pub struct {name};\n").unwrap();
    writeln!(output, "#[async_graphql::Object(name = \"{name}\")]").unwrap();
    writeln!(output, "impl {name} {{").unwrap();
    for field in definition.fields.values() {
        let complexity = config.complexity(name, &field.name);
        let attributes = write_delegating_method(output, name, field, schema, complexity)?;
        ensure!(
            attributes.scope.is_some() || attributes.dynamic_scope,
            "root field {name}.{} must declare @requiresScope or @requiresDynamicScope",
            field.name
        );
    }
    writeln!(output, "}}\n").unwrap();
    Ok(())
}
