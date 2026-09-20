use super::*;

fn check_generated_sdl(schema: &str, config: &str, assertions: &str) {
    let config = parse(config).unwrap();
    let outputs = generate_outputs(schema, &config).unwrap();
    let validated = Schema::parse_and_validate(schema, "contract.graphql").unwrap();
    let directory = tempfile::tempdir().unwrap();
    let generated_dir = directory.path().join("schema");
    fs::create_dir(&generated_dir).unwrap();
    fs::write(generated_dir.join("generated.rs"), outputs.schema).unwrap();
    fs::write(generated_dir.join("objects.rs"), outputs.objects).unwrap();
    fs::write(generated_dir.join("roots.rs"), outputs.roots).unwrap();
    let checks = format!(
        "let sdl = async_graphql::Schema::build(Query, Mutation, async_graphql::EmptySubscription).finish().sdl();\n{assertions}"
    );
    let source = compile_fixture(&validated, &config, &checks);
    let path = directory.path().join("contract.rs");
    fs::write(&path, source).unwrap();
    trybuild::TestCases::new().pass(path);
}

fn generation_error(schema: &str, config: &str) -> String {
    generate_outputs(schema, &parse(config).unwrap())
        .unwrap_err()
        .to_string()
}

#[test]
fn unconfigured_argument_is_rejected() {
    assert_eq!(
        generation_error(
            &schema_with_roots("type Example { values(limit: Int): [String!]! }", "Example"),
            "resolver = []",
        ),
        "Example.values has arguments; add [[resolver]] type = \"Example\" field = \"values\" to resolvers.toml"
    );
}

#[test]
fn configured_argument_is_preserved() {
    check_generated_sdl(
        &schema_with_roots(
            "type Example { label: String values(limit: Int): [String!]! }",
            "Example",
        ),
        "[[resolver]]\ntype = \"Example\"\nfield = \"values\"",
        "assert!(sdl.contains(\"values(limit: Int)\"), \"{sdl}\");",
    );
}

#[test]
fn nested_default_is_rejected() {
    for argument in ["limit: Int! = 10", "limit: Int = 10"] {
        assert_eq!(
            generation_error(
                &schema_with_roots(
                    &format!("type Example {{ label: String values({argument}): [String!]! }}"),
                    "Example",
                ),
                "[[resolver]]\ntype = \"Example\"\nfield = \"values\"",
            ),
            "unsupported default value for argument Example.values.limit"
        );
    }
}

#[test]
fn union_field_compiles() {
    check_generated_sdl(
        &schema_with_roots(
            "type Payload { result: SearchResult } union SearchResult = Example type Example { label: String }",
            "Payload",
        ),
        "resolver = []",
        "assert!(sdl.contains(\"result: SearchResult\"), \"{sdl}\");",
    );
}

#[test]
fn node_field_compiles() {
    check_generated_sdl(
        &schema_with_roots(
            "interface Node { id: ID! } type Payload { result: Node } type Example implements Node { id: ID! label: String }",
            "Payload",
        ),
        "resolver = []",
        "assert!(sdl.contains(\"result: Node\"), \"{sdl}\");",
    );
}

#[test]
fn unsupported_node_shapes_are_rejected() {
    for (definitions, message) in [
        (
            "interface Node { id: ID! label: String } type Example implements Node { id: ID! label: String }",
            "unsupported Node interface field label; only id: ID! is supported",
        ),
        (
            "interface Node { id(raw: Boolean): ID! } type Example implements Node { id(raw: Boolean): ID! }",
            "Node interface id must not have arguments",
        ),
        (
            "interface Node { id: ID! } type Example implements Node { id(raw: Boolean): ID! }",
            "Node type Example id must not have arguments",
        ),
    ] {
        assert_eq!(
            generation_error(&schema_with_roots(definitions, "Node"), "resolver = []"),
            message,
            "{definitions}"
        );
    }
}

#[test]
fn root_requires_scope() {
    for (query, mutation, message) in [
        (
            "secret: String",
            "mutate: Boolean @requiresScope(scope: \"write:test\")",
            "root field Query.secret must declare @requiresScope or @requiresDynamicScope",
        ),
        (
            "secret: String @requiresScope(scope: \"read:test\")",
            "mutate: Boolean",
            "root field Mutation.mutate must declare @requiresScope or @requiresDynamicScope",
        ),
    ] {
        assert_eq!(
            generation_error(
                &format!(
                    r#"
                    directive @requiresScope(scope: String!) on FIELD_DEFINITION
                    type Query {{ {query} }}
                    type Mutation {{ {mutation} }}
                    "#
                ),
                "resolver = []",
            ),
            message
        );
    }
}

#[test]
fn complexity_config_is_emitted_and_enforced() {
    check_generated_sdl(
        r#"
        directive @requiresScope(scope: String!) on FIELD_DEFINITION
        type Query { values(ids: [ID!]!): [Example!]! @requiresScope(scope: "read:test") }
        type Mutation { mutate: Boolean @requiresScope(scope: "write:test") }
        type Example { label: String }
        "#,
        "resolver = []\n[[complexity]]\ntype = \"Query\"\nfield = \"values\"\nexpr = \"ids.len().max(1) * child_complexity.max(1)\"",
        r##"
        assert!(sdl.contains("values(ids: [ID!]!)"), "{sdl}");
        let schema = async_graphql::Schema::build(Query, Mutation, async_graphql::EmptySubscription).limit_complexity(3).finish();
        let mut future = std::pin::pin!(schema.execute(r#"{ values(ids: ["a", "b", "c", "d"]) { label } }"#));
        let mut context = std::task::Context::from_waker(std::task::Waker::noop());
        let std::task::Poll::Ready(response) = std::future::Future::poll(future.as_mut(), &mut context) else {
            panic!("fixture unexpectedly suspended");
        };
        assert_eq!(response.errors.len(), 1, "{:?}", response.errors);
        assert_eq!(response.errors[0].message, "Query is too complex.");
        let mut future = std::pin::pin!(schema.execute(r#"{ values(ids: ["a", "b", "c"]) { label } }"#));
        let std::task::Poll::Ready(response) = std::future::Future::poll(future.as_mut(), &mut context) else {
            panic!("fixture unexpectedly suspended");
        };
        assert_ne!(response.errors[0].message, "Query is too complex.");
        "##,
    );
}

#[test]
fn complexity_config_rejects_unknown_and_non_root_fields() {
    let schema = schema_with_roots("type Example { label: String }", "Example");
    for (config, message) in [
        (
            "resolver = []\n[[complexity]]\ntype = \"Query\"\nfield = \"missing\"\nexpr = \"1\"",
            "complexity config field Query.missing does not exist",
        ),
        (
            "resolver = []\n[[complexity]]\ntype = \"Example\"\nfield = \"label\"\nexpr = \"1\"",
            "complexity config type Example is not a root type",
        ),
        (
            "resolver = []\n[[complexity]]\ntype = \"Query\"\nfield = \"value\"\nexpr = \"1\"\n[[complexity]]\ntype = \"Query\"\nfield = \"value\"\nexpr = \"2\"",
            "complexity config has duplicate Query.value",
        ),
    ] {
        assert_eq!(generation_error(&schema, config), message, "{config}");
    }
}

#[test]
fn real_schema_assembles() {
    let schema = read_schema(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../schema").as_path()).unwrap();
    check_generated_sdl(
        &schema,
        include_str!("../resolvers.toml"),
        "assert!(sdl.contains(\"interface Node\"));",
    );
}

#[test]
fn resolver_only_object_compiles() {
    check_generated_sdl(
        &schema_with_roots("type Example { value: String }", "Example"),
        "[[resolver]]\ntype = \"Example\"\nfield = \"value\"",
        "assert!(sdl.contains(\"value: String\"), \"{sdl}\");",
    );
}

#[test]
fn id_only_node_compiles() {
    check_generated_sdl(
        &schema_with_roots(
            "interface Node { id: ID! } type Example implements Node { id: ID! }",
            "Node",
        ),
        "resolver = []",
        "assert!(sdl.contains(\"type Example implements Node\"), \"{sdl}\");",
    );
}

#[test]
fn argument_deprecation_and_description_are_preserved() {
    check_generated_sdl(
        r#"
        directive @requiresScope(scope: String!) on FIELD_DEFINITION
        type Query {
            value("Lookup key" key: String @deprecated(reason: "use id"), id: ID): Example @requiresScope(scope: "read:test")
        }
        type Mutation { mutate: Boolean @requiresScope(scope: "write:test") }
        type Example { label: String values(limit: Int @deprecated(reason: "use first"), first: Int): [String!]! }
        "#,
        "[[resolver]]\ntype = \"Example\"\nfield = \"values\"",
        r#"
        assert!(sdl.contains("limit: Int @deprecated(reason: \"use first\")"), "{sdl}");
        assert!(sdl.contains("key: String @deprecated(reason: \"use id\")"), "{sdl}");
        assert!(sdl.contains("Lookup key"), "{sdl}");
        "#,
    );
}

#[test]
fn method_backed_type_description_is_preserved() {
    let schema = schema_with_roots("\"Computed values\" type Example { value: String }", "Example");
    for config in ["resolver = []", "[[resolver]]\ntype = \"Example\"\nfield = \"value\""] {
        check_generated_sdl(
            &schema,
            config,
            "assert!(sdl.contains(\"Computed values\"), \"{sdl}\");",
        );
    }
}

#[test]
fn nullable_resolver_error_keeps_response_shape() {
    check_nullable_error_shape("value: String");
}

#[test]
fn nullable_complex_resolver_error_keeps_response_shape() {
    check_nullable_error_shape("value: String label: String");
}

fn check_nullable_error_shape(fields: &str) {
    check_generated_sdl(
        &schema_with_roots(
            &format!(
                "type Example {{ {fields} }} interface Node {{ id: ID! }} type Minimal implements Node {{ id: ID! }}"
            ),
            "Example",
        ),
        "[[resolver]]\ntype = \"Example\"\nfield = \"value\"",
        r#"
        assert!(sdl.contains("value: String"));
        struct Probe;
        #[async_graphql::Object]
        impl Probe {
            async fn example(&self) -> Example { Example::default() }
            async fn node(&self) -> Node { Minimal { id: 42 }.into() }
        }
        let schema = async_graphql::Schema::build(Probe, async_graphql::EmptyMutation, async_graphql::EmptySubscription).finish();
        let mut future = std::pin::pin!(schema.execute("{ example { __typename value } node { id } }"));
        let mut context = std::task::Context::from_waker(std::task::Waker::noop());
        // Every resolver in this fixture is immediately ready; no executor or I/O is needed.
        let std::task::Poll::Ready(response) = std::future::Future::poll(future.as_mut(), &mut context) else {
            panic!("fixture unexpectedly suspended");
        };
        assert_eq!(response.errors.len(), 1);
        assert_eq!(response.errors[0].message, "stub");
        assert_eq!(response.errors[0].path, vec![
            async_graphql::PathSegment::Field("example".into()),
            async_graphql::PathSegment::Field("value".into()),
        ]);
        assert_eq!(response.data, async_graphql::value!({"example": {"__typename": "Example", "value": null}, "node": {"id": ""}}));
        "#,
    );
}
