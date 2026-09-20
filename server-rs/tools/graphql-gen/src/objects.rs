use std::{collections::BTreeSet, fmt::Write as _};

use anyhow::{Context, Result, bail, ensure};
use apollo_compiler::{
    Name, Schema,
    ast::Type,
    collections::IndexMap,
    schema::{Component, ExtendedType, FieldDefinition, InterfaceType, ObjectType, UnionType},
};
use heck::ToUpperCamelCase;

use crate::{
    config::ResolverConfig,
    support::{
        field_attributes, field_metadata, rust_identifier, rust_type, write_delegating_method, write_docs,
        write_guarded_accessor, write_trait_method,
    },
};

const NULLABLE: &str = "\
pub async fn nullable<T>(
    ctx: &async_graphql::Context<'_>,
    field: impl std::future::Future<Output = async_graphql::Result<Option<T>>>,
) -> async_graphql::Result<Option<T>> {
    match field.await {
        Err(error) => {
            ctx.add_error(ctx.set_error_path(error.into_server_error(ctx.item.pos)));
            Ok(None)
        }
        value => value,
    }
}

";

pub(crate) fn write_objects(output: &mut String, schema: &Schema, resolvers: &ResolverConfig) -> Result<()> {
    let defaultable = defaultable_objects(schema, resolvers)?;
    writeln!(output, "use super::generated::*;\n").unwrap();
    output.push_str(NULLABLE);
    write_scopes(output, schema)?;
    write_interfaces(output, schema)?;
    write_unions(output, schema);
    for definition in object_types(schema) {
        write_object(output, definition, schema, resolvers, &defaultable)?;
    }
    Ok(())
}

fn write_scopes(output: &mut String, schema: &Schema) -> Result<()> {
    let mut scopes = Vec::new();
    for object in scope_types(schema) {
        for field in object.fields.values() {
            if let Some(scope) = field_metadata(&field.name, &field.directives)?.scope {
                scopes.push((object.name.to_string(), field.name.to_string(), scope));
            }
        }
    }
    writeln!(output, "pub const SCOPES: &[(&str, &str, &str)] = &[").unwrap();
    for (type_name, field_name, scope) in scopes {
        writeln!(output, "    ({type_name:?}, {field_name:?}, {scope:?}),").unwrap();
    }
    writeln!(output, "];\n").unwrap();
    Ok(())
}

fn write_interfaces(output: &mut String, schema: &Schema) -> Result<()> {
    for definition in schema.types.values() {
        if let ExtendedType::Interface(definition) = definition
            && !definition.name.starts_with("__")
        {
            write_node(output, definition, schema)?;
        }
    }
    Ok(())
}

fn write_node(output: &mut String, definition: &InterfaceType, schema: &Schema) -> Result<()> {
    ensure!(definition.name == "Node", "unsupported interface {}", definition.name);
    node_id_field(&definition.fields, "Node interface")?;
    if let Some(extra) = definition.fields.keys().find(|name| *name != "id") {
        bail!("unsupported Node interface field {extra}; only id: ID! is supported");
    }

    write_docs(output, definition.description.as_deref(), "");
    writeln!(output, "#[derive(async_graphql::Interface, Clone, Debug, PartialEq)]").unwrap();
    writeln!(
        output,
        "#[graphql(name = \"Node\", field(name = \"id\", ty = \"async_graphql::ID\"))]"
    )
    .unwrap();
    writeln!(output, "pub enum Node {{").unwrap();
    for object in schema.types.values().filter_map(|definition| match definition {
        ExtendedType::Object(object) if is_node(object) => Some(object),
        _ => None,
    }) {
        let name = object.name.to_upper_camel_case();
        writeln!(output, "    {name}({name}),").unwrap();
    }
    writeln!(output, "}}\n").unwrap();
    Ok(())
}

fn write_unions(output: &mut String, schema: &Schema) {
    let mut types = schema
        .types
        .iter()
        .filter_map(|(name, definition)| match definition {
            ExtendedType::Union(definition) if !name.starts_with("__") => Some(definition),
            _ => None,
        })
        .collect::<Vec<_>>();
    types.sort_by_key(|definition| definition.name.clone());
    for definition in types {
        write_union(output, definition);
    }
}

fn write_union(output: &mut String, definition: &UnionType) {
    let name = definition.name.to_upper_camel_case();
    write_docs(output, definition.description.as_deref(), "");
    writeln!(output, "#[derive(async_graphql::Union, Clone, Debug, PartialEq)]").unwrap();
    writeln!(output, "#[graphql(name = \"{}\")]", definition.name).unwrap();
    writeln!(output, "pub enum {name} {{").unwrap();
    for member in &definition.members {
        let member = member.to_upper_camel_case();
        writeln!(output, "    {member}({member}),").unwrap();
    }
    writeln!(output, "}}\n").unwrap();
}

fn write_object(
    output: &mut String,
    definition: &ObjectType,
    schema: &Schema,
    resolvers: &ResolverConfig,
    defaultable: &BTreeSet<String>,
) -> Result<()> {
    let name = definition.name.to_upper_camel_case();
    let node = is_node(definition);
    if node {
        node_id_field(&definition.fields, &format!("Node type {}", definition.name))?;
    }
    let fields = definition
        .fields
        .values()
        .filter(|field| !(node && field.name == "id"))
        .map(|field| Ok((field.as_ref(), field_kind(definition, field, resolvers)?)))
        .collect::<Result<Vec<_>>>()?;
    // async-graphql rejects a SimpleObject without exposed fields, so objects whose every field is a
    // method (resolver, guarded accessor, or the internal Node id) become a plain struct with an
    // Object impl instead.
    let method_backed = fields.iter().all(|(_, kind)| *kind != FieldKind::Stored);
    let complex = node || fields.iter().any(|(_, kind)| *kind != FieldKind::Stored);
    let derives = format!(
        "Clone, Debug, PartialEq{}",
        if defaultable.contains(definition.name.as_str()) { ", Default" } else { "" }
    );
    write_docs(output, definition.description.as_deref(), "");
    if method_backed {
        writeln!(output, "#[derive({derives})]").unwrap();
    } else {
        writeln!(output, "#[derive(async_graphql::SimpleObject, {derives})]").unwrap();
        writeln!(output, "#[graphql(name = \"{}\")]", definition.name).unwrap();
        if complex {
            writeln!(output, "#[graphql(complex)]").unwrap();
        }
    }
    writeln!(output, "pub struct {name} {{").unwrap();
    if node {
        if !method_backed {
            writeln!(output, "    #[graphql(skip)]").unwrap();
        }
        writeln!(output, "    pub id: i64,").unwrap();
    }
    for (field, kind) in &fields {
        match kind {
            FieldKind::Resolver => continue,
            FieldKind::Guarded if !method_backed => writeln!(output, "    #[graphql(skip)]").unwrap(),
            FieldKind::Guarded => {}
            FieldKind::Stored => {
                write_docs(output, field.description.as_deref(), "    ");
                field_attributes(output, &field.name, &field.directives, "    ")?;
            }
        }
        writeln!(
            output,
            "    pub {}: {},",
            rust_identifier(&field.name),
            rust_type(&field.ty, schema).with_context(|| format!("type of {}.{}", definition.name, field.name))?
        )
        .unwrap();
    }
    writeln!(output, "}}\n").unwrap();

    if has_resolvers(definition, resolvers) {
        write_resolver_trait(output, definition, schema, resolvers)?;
    }
    if method_backed {
        write_docs(output, definition.description.as_deref(), "");
        writeln!(output, "#[async_graphql::Object(name = \"{}\")]", definition.name).unwrap();
    } else if complex {
        writeln!(output, "#[async_graphql::ComplexObject]").unwrap();
    }
    if complex {
        write_complex_object(output, definition, schema, &fields)?;
    }
    Ok(())
}

#[derive(Clone, Copy, PartialEq)]
enum FieldKind {
    Stored,
    Guarded,
    Resolver,
}

fn field_kind(definition: &ObjectType, field: &FieldDefinition, resolvers: &ResolverConfig) -> Result<FieldKind> {
    if resolvers.contains(&definition.name, &field.name) {
        return Ok(FieldKind::Resolver);
    }
    ensure!(
        field.arguments.is_empty(),
        "{}.{} has arguments; add [[resolver]] type = {:?} field = {:?} to resolvers.toml",
        definition.name,
        field.name,
        definition.name,
        field.name
    );
    let guarded = field_metadata(&field.name, &field.directives)?.guard().is_some();
    Ok(if guarded { FieldKind::Guarded } else { FieldKind::Stored })
}

fn write_resolver_trait(
    output: &mut String,
    definition: &ObjectType,
    schema: &Schema,
    resolvers: &ResolverConfig,
) -> Result<()> {
    let trait_name = format!("{}Resolvers", definition.name.to_upper_camel_case());
    writeln!(output, "pub trait {trait_name} {{").unwrap();
    for field in resolver_fields(definition, resolvers) {
        write_trait_method(output, &definition.name, field, schema)?;
    }
    writeln!(output, "}}\n").unwrap();
    Ok(())
}

fn write_complex_object(
    output: &mut String,
    definition: &ObjectType,
    schema: &Schema,
    fields: &[(&FieldDefinition, FieldKind)],
) -> Result<()> {
    let name = definition.name.to_upper_camel_case();
    writeln!(output, "impl {name} {{").unwrap();
    if is_node(definition) {
        let id = node_id_field(&definition.fields, &format!("Node type {}", definition.name))?;
        write_docs(output, id.description.as_deref(), "    ");
        field_attributes(output, &id.name, &id.directives, "    ")?;
        writeln!(output, "    async fn id(&self) -> async_graphql::ID {{").unwrap();
        writeln!(
            output,
            "        crate::ids::GlobalId::new(crate::ids::GlobalIdType::{name}, self.id).encoded_string().into()"
        )
        .unwrap();
        writeln!(output, "    }}\n").unwrap();
    }
    for (field, kind) in fields {
        match kind {
            FieldKind::Stored => {}
            FieldKind::Guarded => write_guarded_accessor(output, field, schema)?,
            FieldKind::Resolver => {
                write_delegating_method(output, &definition.name, field, schema, None)?;
            }
        }
    }
    writeln!(output, "}}\n").unwrap();
    Ok(())
}

fn object_types(schema: &Schema) -> impl Iterator<Item = &ObjectType> {
    scope_types(schema).filter(|definition| definition.name != "Query" && definition.name != "Mutation")
}

fn scope_types(schema: &Schema) -> impl Iterator<Item = &ObjectType> {
    let mut types = schema
        .types
        .iter()
        .filter_map(|(name, definition)| match definition {
            ExtendedType::Object(definition) if !name.starts_with("__") => Some(definition),
            _ => None,
        })
        .map(|definition| definition.as_ref())
        .collect::<Vec<_>>();
    types.sort_by_key(|definition| definition.name.clone());
    types.into_iter()
}

fn resolver_fields<'a>(
    definition: &'a ObjectType,
    resolvers: &'a ResolverConfig,
) -> impl Iterator<Item = &'a FieldDefinition> {
    definition
        .fields
        .values()
        .map(|field| field.as_ref())
        .filter(move |field| resolvers.contains(&definition.name, &field.name))
}

fn has_resolvers(definition: &ObjectType, resolvers: &ResolverConfig) -> bool {
    resolver_fields(definition, resolvers).next().is_some()
}

fn is_node(definition: &ObjectType) -> bool {
    definition
        .implements_interfaces
        .iter()
        .any(|interface| interface.name == "Node")
}

fn node_id_field<'a>(
    fields: &'a IndexMap<Name, Component<FieldDefinition>>,
    owner: &str,
) -> Result<&'a FieldDefinition> {
    let id = fields
        .get("id")
        .with_context(|| format!("{owner} must define id: ID!"))?;
    ensure!(
        matches!(&id.ty, Type::NonNullNamed(name) if name == "ID"),
        "{owner} id must have type ID!"
    );
    ensure!(id.arguments.is_empty(), "{owner} id must not have arguments");
    Ok(id)
}

fn defaultable_objects(schema: &Schema, resolvers: &ResolverConfig) -> Result<BTreeSet<String>> {
    let mut defaultable = BTreeSet::new();
    loop {
        let additions = object_types(schema)
            .filter(|definition| object_is_defaultable(definition, schema, resolvers, &defaultable))
            .map(|definition| definition.name.to_string())
            .collect::<BTreeSet<_>>();
        if additions.is_subset(&defaultable) {
            return Ok(defaultable);
        }
        defaultable.extend(additions);
    }
}

fn object_is_defaultable(
    definition: &ObjectType,
    schema: &Schema,
    resolvers: &ResolverConfig,
    defaultable: &BTreeSet<String>,
) -> bool {
    definition.fields.values().all(|field| {
        (is_node(definition) && field.name == "id")
            || resolvers.contains(&definition.name, &field.name)
            || type_is_defaultable(&field.ty, schema, defaultable)
    })
}

fn type_is_defaultable(ty: &Type, schema: &Schema, defaultable: &BTreeSet<String>) -> bool {
    if !ty.is_non_null() || matches!(ty, Type::List(_) | Type::NonNullList(_)) {
        return true;
    }
    let name = ty.inner_named_type();
    match schema.types.get(name) {
        Some(ExtendedType::Scalar(_)) => matches!(name.as_str(), "ID" | "String" | "Int" | "Float" | "Boolean"),
        Some(ExtendedType::Object(_)) => defaultable.contains(name.as_str()),
        Some(
            ExtendedType::Interface(_) | ExtendedType::Union(_) | ExtendedType::Enum(_) | ExtendedType::InputObject(_),
        )
        | None => false,
    }
}
