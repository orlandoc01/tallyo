use std::{collections::BTreeMap, fmt::Write as _};

use anyhow::{Context, Result, bail, ensure};
use apollo_compiler::{
    Schema,
    ast::{Type, Value},
    schema::{EnumType, ExtendedType, InputObjectType},
};
use heck::ToUpperCamelCase;

use crate::support::{json_schema_type, rust_identifier, rust_type, write_docs};

pub(crate) fn write_schema(output: &mut String, schema: &Schema) -> Result<()> {
    let types = schema
        .types
        .iter()
        .filter(|(name, _)| !name.starts_with("__"))
        .collect::<BTreeMap<_, _>>();
    for definition in types.values() {
        if let ExtendedType::Enum(definition) = definition {
            write_enum(output, definition);
        }
    }
    for definition in types.values() {
        if let ExtendedType::InputObject(definition) = definition {
            write_input(output, definition, schema)?;
        }
    }
    Ok(())
}

fn write_enum(output: &mut String, definition: &EnumType) {
    let name = &definition.name;
    write_docs(output, definition.description.as_deref(), "");
    writeln!(output, "#[derive(async_graphql::Enum, serde::Serialize, serde::Deserialize, schemars::JsonSchema, Clone, Copy, Debug, PartialEq, Eq, Hash, strum_macros::Display, strum_macros::EnumString, strum_macros::EnumIter)]").unwrap();
    writeln!(output, "#[graphql(name = \"{name}\")]").unwrap();
    writeln!(output, "pub enum {} {{", name.to_upper_camel_case()).unwrap();
    for (name, value) in &definition.values {
        write_docs(output, value.description.as_deref(), "    ");
        writeln!(output, "    #[graphql(name = \"{name}\")]").unwrap();
        writeln!(output, "    #[serde(rename = \"{name}\")]").unwrap();
        writeln!(output, "    #[strum(serialize = \"{name}\")]").unwrap();
        writeln!(output, "    {},", name.to_upper_camel_case()).unwrap();
    }
    writeln!(output, "}}\n").unwrap();
}

fn write_input(output: &mut String, definition: &InputObjectType, schema: &Schema) -> Result<()> {
    let name = &definition.name;
    write_docs(output, definition.description.as_deref(), "");
    writeln!(
        output,
        "#[derive(async_graphql::InputObject, serde::Deserialize, schemars::JsonSchema, Clone, Debug, PartialEq)]"
    )
    .unwrap();
    writeln!(output, "#[graphql(name = \"{name}\")]").unwrap();
    writeln!(output, "#[serde(deny_unknown_fields)]").unwrap();
    writeln!(output, "pub struct {} {{", name.to_upper_camel_case()).unwrap();
    for field in definition.fields.values() {
        write_docs(output, field.description.as_deref(), "    ");
        writeln!(output, "    #[graphql(name = \"{}\")]", field.name).unwrap();
        writeln!(output, "    #[serde(rename = \"{}\")]", field.name).unwrap();
        let rust = rust_type(&field.ty, schema).with_context(|| format!("type of {name}.{}", field.name))?;
        let json_schema = json_schema_type(&field.ty, schema)?;
        if json_schema != rust {
            writeln!(output, "    #[schemars(with = \"{json_schema}\")]").unwrap();
        }
        if let Some(default) = &field.default_value {
            let default = rust_default_value(default, &field.ty, schema)
                .with_context(|| format!("default value for {name}.{}", field.name))?;
            let default = if field.ty.is_non_null() { default } else { format!("Some({default})") };
            writeln!(output, "    #[graphql(default_with = {default:?})]").unwrap();
        }
        writeln!(output, "    pub {}: {rust},", rust_identifier(&field.name)).unwrap();
    }
    writeln!(output, "}}\n").unwrap();
    Ok(())
}

fn rust_default_value(default: &Value, ty: &Type, schema: &Schema) -> Result<String> {
    ensure!(
        matches!(ty, Type::Named(_) | Type::NonNullNamed(_)),
        "unsupported list default"
    );
    let name = ty.inner_named_type();
    match (default, name.as_str()) {
        (Value::Boolean(value), "Boolean") => Ok(value.to_string()),
        (Value::Int(value), "Int") => Ok(value.to_string()),
        (Value::Int(value), "Float") => Ok(format!("{value}f64")),
        (Value::Float(value), "Float") => Ok(format!("{value}f64")),
        (Value::String(value), "String") => Ok(format!("{value:?}.to_owned()")),
        (Value::String(value), "ID") => Ok(format!("async_graphql::ID::from({value:?})")),
        (Value::Int(value), "ID") => Ok(format!("async_graphql::ID::from(\"{value}\")")),
        (Value::Enum(value), _) if matches!(schema.types.get(name), Some(ExtendedType::Enum(_))) => Ok(format!(
            "{}::{}",
            name.to_upper_camel_case(),
            value.to_upper_camel_case()
        )),
        _ => bail!("unsupported default {default} for {ty}"),
    }
}
