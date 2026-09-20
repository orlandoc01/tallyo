use std::collections::BTreeSet;

use anyhow::{Context, Result, ensure};
use apollo_compiler::{Schema, schema::ExtendedType};
use serde::Deserialize;

#[derive(Deserialize)]
pub(crate) struct ResolverConfig {
    resolver: Vec<Resolver>,
    #[serde(default)]
    complexity: Vec<Complexity>,
}

#[derive(Deserialize)]
struct Resolver {
    r#type: String,
    field: String,
}

#[derive(Deserialize)]
struct Complexity {
    r#type: String,
    field: String,
    expr: String,
}

pub(crate) fn default_config() -> Result<ResolverConfig> {
    parse(include_str!("../resolvers.toml"))
}

pub(crate) fn parse(source: &str) -> Result<ResolverConfig> {
    toml::from_str(source).context("parse resolver config")
}

impl ResolverConfig {
    pub(crate) fn contains(&self, type_name: &str, field_name: &str) -> bool {
        self.resolver
            .iter()
            .any(|resolver| resolver.r#type == type_name && resolver.field == field_name)
    }

    pub(crate) fn complexity(&self, type_name: &str, field_name: &str) -> Option<&str> {
        self.complexity
            .iter()
            .find(|complexity| complexity.r#type == type_name && complexity.field == field_name)
            .map(|complexity| complexity.expr.as_str())
    }

    pub(crate) fn validate(&self, schema: &Schema) -> Result<()> {
        let resolvers = self.resolver.iter().map(|resolver| (&resolver.r#type, &resolver.field));
        validate_entries(schema, "resolver", resolvers)?;
        let complexities = self
            .complexity
            .iter()
            .map(|complexity| (&complexity.r#type, &complexity.field));
        validate_entries(schema, "complexity", complexities)?;
        for complexity in &self.complexity {
            ensure!(
                matches!(complexity.r#type.as_str(), "Query" | "Mutation"),
                "complexity config type {} is not a root type",
                complexity.r#type
            );
        }
        Ok(())
    }
}

fn validate_entries<'a>(
    schema: &Schema,
    kind: &str,
    entries: impl Iterator<Item = (&'a String, &'a String)>,
) -> Result<()> {
    let mut fields = BTreeSet::new();
    for (type_name, field_name) in entries {
        ensure!(
            fields.insert((type_name, field_name)),
            "{kind} config has duplicate {type_name}.{field_name}"
        );
        let Some(ExtendedType::Object(object)) = schema.types.get(type_name.as_str()) else {
            anyhow::bail!("{kind} config type {type_name} does not exist");
        };
        ensure!(
            object.fields.contains_key(field_name.as_str()),
            "{kind} config field {type_name}.{field_name} does not exist"
        );
    }
    Ok(())
}
