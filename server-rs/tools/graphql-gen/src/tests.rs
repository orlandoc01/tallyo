use std::{fmt::Write as _, fs, path::Path};

use apollo_compiler::{Schema, schema::ExtendedType};
use heck::ToUpperCamelCase;

use super::{
    config::{ResolverConfig, default_config, parse},
    generate_outputs, generate_schema, read_schema,
    support::{rust_identifier, rust_type},
};

#[path = "output_contract.rs"]
mod output_contract;

fn schema_with_roots(definitions: &str, query_type: &str) -> String {
    format!(
        r#"
        directive @requiresScope(scope: String!) on FIELD_DEFINITION
        type Query {{ value: {query_type} @requiresScope(scope: "read:test") }}
        type Mutation {{ mutate: Boolean @requiresScope(scope: "write:test") }}
        {definitions}
        "#
    )
}

#[test]
fn generation_is_independent_of_definition_order() {
    let definitions = [
        "type Query { value: String }",
        "enum Example { FIRST_VALUE }",
        "input ExampleInput { fieldName: String }",
        "extend enum Example { SECOND_VALUE }",
        "extend input ExampleInput { count: Int }",
    ];
    let output = generate_schema(&definitions.join("\n")).unwrap();
    let reversed = definitions.into_iter().rev().collect::<Vec<_>>().join("\n");

    assert_eq!(output, generate_schema(&reversed).unwrap());
    assert!(output.contains("SecondValue,"));
    assert!(output.contains("pub count: Option<i32>"));
    assert!(!output.contains("__TypeKind"));
    assert!(!output.contains("__DirectiveLocation"));
}

#[test]
fn emits_serde_and_json_schema_attributes() {
    let output = generate_schema(
        r#"
        scalar Money
        type Query { value: String }
        enum Example { FIRST_VALUE }
        input ExampleInput { ids: [ID!], amount: Money!, nested: [[ID]!]! }
        "#,
    )
    .unwrap();

    assert!(output.contains("#[serde(rename = \"FIRST_VALUE\")]"));
    assert!(output.contains("#[serde(deny_unknown_fields)]"));
    assert!(
        output.contains("#[serde(rename = \"ids\")]\n    #[schemars(with = \"Option<Vec<crate::ids::GlobalId>>\")]")
    );
    assert!(output.contains("#[schemars(with = \"Vec<Vec<Option<crate::ids::GlobalId>>>\")]"));
    assert!(output.contains("#[serde(rename = \"amount\")]\n    pub amount: crate::money::Cents,"));
}

#[test]
fn rejects_invalid_schemas_and_unmapped_scalars() {
    for definition in [
        "input ExampleInput { value: Unknown }",
        "enum Example { FIRST } enum Example { SECOND }",
        "input ExampleInput { value: String } extend input ExampleInput { value: Int }",
        "extend input Missing { value: String }",
        "enum Example { FIRST } extend enum Example { FIRST }",
        "input ExampleInput { value: Int = true }",
        "scalar Unmapped input ExampleInput { value: Unmapped }",
    ] {
        assert!(
            generate_schema(&format!("type Query {{ value: String }} {definition}")).is_err(),
            "{definition}"
        );
    }
}

#[test]
fn rejects_unsupported_defaults() {
    for fields in [
        "values: [String!]! = [\"value\"]",
        "value: String = null",
        "value: ExampleInput = { plain: \"value\" }",
    ] {
        let schema = format!("type Query {{ value: String }} input ExampleInput {{ plain: String {fields} }}");
        assert!(generate_schema(&schema).is_err(), "{fields}");
    }
}

#[test]
fn generated_defaults_and_extensions_compile_and_parse() {
    let schema = r#"
        type Query { value: String }
        enum Example { FIRST }
        extend enum Example { SECOND }
        input ExampleInput {
            kind: Example! = SECOND
            optionalKind: Example = FIRST
            label: String = "hello \"Rust\"\n"
            requiredLabel: String! = "required"
            flag: Boolean = false
            count: Int! = -2
            whole: Float = 1
            fraction: Float! = 1.25
            id: ID! = "example"
            numericId: ID = 123
            type: String
            matrix: [[ID]!]
        }
        extend input ExampleInput { extra: Boolean! = true }
    "#;
    let mut source = generate_schema(schema).unwrap();
    source.push_str(SCALAR_STUBS);
    source.push_str(r#"
        fn main() {
            use async_graphql::{InputType, value};
            use strum::IntoEnumIterator;

            let json_schema = schemars::schema_for!(ExampleInput).to_value().to_string();
            assert!(json_schema.contains("\"additionalProperties\":false"), "{json_schema}");
            assert!(json_schema.contains("\"requiredLabel\""), "{json_schema}");
            assert!(json_schema.contains("\"global-id\""), "{json_schema}");
            let parsed: ExampleInput = serde_json::from_str("{\"kind\":\"FIRST\",\"requiredLabel\":\"x\",\"count\":1,\"fraction\":2.5,\"id\":\"a\",\"extra\":false}").unwrap();
            assert_eq!(parsed.kind, Example::First);
            assert!(serde_json::from_str::<ExampleInput>("{\"kind\":\"FIRST\",\"unknown\":true}").is_err());

            let input = ExampleInput::parse(Some(value!({}))).unwrap();
            assert_eq!(input.kind, Example::Second);
            assert_eq!(input.optional_kind, Some(Example::First));
            assert_eq!(input.label.as_deref(), Some("hello \"Rust\"\n"));
            assert_eq!(input.required_label, "required");
            assert_eq!(input.flag, Some(false));
            assert_eq!(input.count, -2);
            assert_eq!(input.whole, Some(1.0));
            assert_eq!(input.fraction, 1.25);
            assert_eq!(input.id.as_str(), "example");
            assert_eq!(input.numeric_id.unwrap().as_str(), "123");
            assert!(input.extra);
            assert_eq!(Example::iter().count(), 2);
            assert_eq!(Example::Second.to_string(), "SECOND");
            assert_eq!("SECOND".parse::<Example>().unwrap(), Example::Second);

            let input = ExampleInput::parse(Some(value!({"flag": null, "type": "test", "matrix": [["id", null]]}))).unwrap();
            assert_eq!(input.flag, None);
            assert_eq!(input.r#type.as_deref(), Some("test"));
            let matrix: Option<Vec<Vec<Option<async_graphql::ID>>>> = input.matrix;
            assert_eq!(matrix.unwrap()[0][0].as_ref().unwrap().as_str(), "id");
        }
    "#);
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("generated.rs");
    fs::write(&path, source).unwrap();
    trybuild::TestCases::new().pass(path);
}

#[test]
fn generates_acronym_names_and_deprecation() {
    let output = generated_objects(
        &schema_with_roots(
            r#"type Example { valueUSD: Float! @deprecated(reason: "use valueUsd") }"#,
            "Example",
        ),
        "resolver = []",
    );

    assert!(output.contains("#[graphql(name = \"valueUSD\", deprecation = \"use valueUsd\")]\n    pub value_usd: f64"));
}

#[test]
fn generates_node_interfaces_and_unions() {
    let output = generated_objects(
        &schema_with_roots(
            r#"
            interface Node { id: ID! }
            type Budget implements Node { id: ID!, month: String! }
            union Result = Budget
            "#,
            "Budget",
        ),
        "resolver = []",
    );

    assert!(output.contains("pub enum Node {\n    Budget(Budget),"));
    assert!(output.contains("#[graphql(skip)]\n    pub id: i64,"));
    assert!(output.contains("GlobalIdType::Budget, self.id"));
    assert!(output.contains("pub enum Result {\n    Budget(Budget),"));
}

#[test]
fn generates_resolver_traits_and_delegation() {
    let output = generated_objects(
        &schema_with_roots(
            r#"
            scalar Date
            type Account { latestSnapshot(date: Date): Snapshot }
            type Snapshot { name: String! }
            "#,
            "Account",
        ),
        r#"
        [[resolver]]
        type = "Account"
        field = "latestSnapshot"
        "#,
    );

    assert!(output.contains("pub trait AccountResolvers"));
    assert!(output.contains("date: Option<crate::ids::Date>"));
    assert!(output.contains("AccountResolvers::latest_snapshot(self, ctx, date).await"));
}

#[test]
fn generates_scope_guards_and_scope_table() {
    let schema = r#"
        directive @requiresScope(scope: String!) on FIELD_DEFINITION
        directive @requiresDynamicScope on FIELD_DEFINITION
        type Query {
            secret: Example @requiresScope(scope: "read:example")
            node(id: ID!): Example @requiresDynamicScope
        }
        type Mutation { mutate: Boolean @requiresScope(scope: "write:example") }
        type Example { private: String @requiresScope(scope: "read:private") }
        "#;
    let output = generate_outputs(schema, &parse("resolver = []").unwrap()).unwrap();

    assert!(output.objects.contains("(\"Example\", \"private\", \"read:private\")"));
    assert!(output.objects.contains("(\"Query\", \"secret\", \"read:example\")"));
    assert!(
        output
            .objects
            .contains("Guard::check(&crate::graph::ScopeGuard::new(\"read:private\"), ctx).await?;")
    );
    assert!(
        output
            .roots
            .contains("Guard::check(&crate::graph::DynamicScopeGuard, ctx).await?;")
    );
}

#[test]
fn generates_configured_root_complexity() {
    let schema = read_schema(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../schema").as_path()).unwrap();
    let outputs = generate_outputs(&schema, &default_config().unwrap()).unwrap();

    assert!(
        outputs
            .roots
            .contains("#[graphql(name = \"nodes\", complexity = \"ids.len().max(1) * child_complexity.max(1)\")]")
    );
}

#[test]
fn rejects_invalid_resolver_config() {
    let error = generate_outputs(
        r#"
        type Query { value: String }
        type Mutation { mutate: Boolean }
        "#,
        &parse("[[resolver]]\ntype = \"Missing\"\nfield = \"value\"").unwrap(),
    )
    .unwrap_err();

    assert_eq!(error.to_string(), "resolver config type Missing does not exist");
}

#[test]
fn real_schema_output_and_roots_compile() {
    let schema = read_schema(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../schema").as_path()).unwrap();
    let outputs = generate_outputs(&schema, &default_config().unwrap()).unwrap();
    let validated = Schema::parse_and_validate(&schema, "schema.graphql").unwrap();
    let directory = tempfile::tempdir().unwrap();
    let generated_dir = directory.path().join("schema");
    fs::create_dir(&generated_dir).unwrap();
    fs::write(generated_dir.join("generated.rs"), outputs.schema).unwrap();
    fs::write(generated_dir.join("objects.rs"), outputs.objects).unwrap();
    fs::write(generated_dir.join("roots.rs"), outputs.roots).unwrap();
    let source = compile_fixture(&validated, &default_config().unwrap(), "");
    let path = directory.path().join("generated_output.rs");
    fs::write(&path, source).unwrap();

    trybuild::TestCases::new().pass(path);
}

fn generated_objects(schema: &str, config: &str) -> String {
    generate_outputs(schema, &parse(config).unwrap()).unwrap().objects
}

// Stand-ins for the crate scalars a generated file references: GraphQL scalar impls plus the
// serde/schemars impls the MCP input schemas need.
const SCALAR_STUBS: &str = r#"
        mod ids {
            #[derive(Clone, Debug, PartialEq, serde::Deserialize, schemars::JsonSchema)]
            pub struct Date;

            #[async_graphql::Scalar]
            impl async_graphql::ScalarType for Date {
                fn parse(_: async_graphql::Value) -> async_graphql::InputValueResult<Self> { Ok(Self) }
                fn to_value(&self) -> async_graphql::Value { async_graphql::Value::Null }
            }

            #[derive(Clone, Copy)]
            pub enum GlobalIdType { Node }

            pub struct GlobalId;

            impl GlobalId {
                pub fn new(_: GlobalIdType, _: i64) -> Self { Self }
                pub fn encoded_string(self) -> String { String::new() }
            }

            impl schemars::JsonSchema for GlobalId {
                fn schema_name() -> std::borrow::Cow<'static, str> { "GlobalID".into() }
                fn json_schema(_: &mut schemars::SchemaGenerator) -> schemars::Schema {
                    schemars::json_schema!({"type": "string", "format": "global-id"})
                }
            }
        }

        mod money {
            #[derive(Clone, Debug, PartialEq, serde::Deserialize, schemars::JsonSchema)]
            pub struct Cents;

            #[async_graphql::Scalar]
            impl async_graphql::ScalarType for Cents {
                fn parse(_: async_graphql::Value) -> async_graphql::InputValueResult<Self> { Ok(Self) }
                fn to_value(&self) -> async_graphql::Value { async_graphql::Value::Null }
            }
        }
"#;

fn compile_fixture(schema: &Schema, resolvers: &ResolverConfig, checks: &str) -> String {
    let node_types = node_types(schema)
        .map(|object| format!("{}, ", object.name.to_upper_camel_case()))
        .collect::<String>();
    let mut source = SCALAR_STUBS.replace(
        "pub enum GlobalIdType { Node }",
        &format!("pub enum GlobalIdType {{ {node_types} }}"),
    );
    source.push_str(
        r#"
        mod graph {
            pub struct ScopeGuard;
            pub struct DynamicScopeGuard;

            impl ScopeGuard {
                pub fn new(_: &str) -> Self { Self }
            }

            impl async_graphql::Guard for ScopeGuard {
                fn check(&self, _: &async_graphql::Context<'_>) -> impl std::future::Future<Output = async_graphql::Result<()>> + Send {
                    async { Ok(()) }
                }
            }

            impl async_graphql::Guard for DynamicScopeGuard {
                fn check(&self, _: &async_graphql::Context<'_>) -> impl std::future::Future<Output = async_graphql::Result<()>> + Send {
                    async { Ok(()) }
                }
            }
        }

        mod schema {
            #[path = "generated.rs"]
            mod generated;
            #[path = "objects.rs"]
            mod objects;
            #[path = "roots.rs"]
            mod roots;

            use generated::*;
            use objects::*;
            use roots::*;
    "#,
    );
    write_resolver_stubs(&mut source, schema, resolvers);
    source.push_str("pub fn check_contract() {\n");
    source.push_str(checks);
    source.push_str("\n}\n}\nfn main() { schema::check_contract(); }\n");
    source
}

fn write_resolver_stubs(output: &mut String, schema: &Schema, resolvers: &ResolverConfig) {
    for definition in schema.types.values().filter_map(|definition| match definition {
        ExtendedType::Object(definition)
            if definition
                .fields
                .values()
                .any(|field| resolvers.contains(&definition.name, &field.name)) =>
        {
            Some(definition)
        }
        _ => None,
    }) {
        write_stub_trait(
            output,
            &format!("{}Resolvers", definition.name.to_upper_camel_case()),
            &definition.name.to_upper_camel_case(),
            definition
                .fields
                .values()
                .filter(|field| resolvers.contains(&definition.name, &field.name)),
            schema,
        );
    }
    for root in ["Query", "Mutation"] {
        let definition = schema.get_object(root).unwrap();
        write_stub_trait(
            output,
            &format!("{root}Resolvers"),
            root,
            definition.fields.values(),
            schema,
        );
    }
}

fn write_stub_trait<'a>(
    output: &mut String,
    trait_name: &str,
    type_name: &str,
    fields: impl Iterator<Item = &'a apollo_compiler::schema::Component<apollo_compiler::schema::FieldDefinition>>,
    schema: &Schema,
) {
    writeln!(output, "            impl {trait_name} for {type_name} {{").unwrap();
    for field in fields {
        writeln!(output, "                #[allow(unused_variables)]").unwrap();
        writeln!(output, "                fn {}(", rust_identifier(&field.name)).unwrap();
        writeln!(output, "                    &self,").unwrap();
        writeln!(output, "                    ctx: &async_graphql::Context<'_>,").unwrap();
        for argument in &field.arguments {
            writeln!(
                output,
                "                    {}: {},",
                rust_identifier(&argument.name),
                rust_type(&argument.ty, schema).unwrap()
            )
            .unwrap();
        }
        writeln!(
            output,
            "                ) -> impl std::future::Future<Output = async_graphql::Result<{}>> + Send {{",
            rust_type(&field.ty, schema).unwrap()
        )
        .unwrap();
        writeln!(
            output,
            "                    async {{ Err(async_graphql::Error::new(\"stub\")) }}"
        )
        .unwrap();
        writeln!(output, "                }}").unwrap();
    }
    writeln!(output, "            }}").unwrap();
}

fn node_types(schema: &Schema) -> impl Iterator<Item = &apollo_compiler::schema::ObjectType> {
    schema.types.values().filter_map(|definition| match definition {
        ExtendedType::Object(object)
            if object
                .implements_interfaces
                .iter()
                .any(|interface| interface.name == "Node") =>
        {
            Some(object.as_ref())
        }
        _ => None,
    })
}
