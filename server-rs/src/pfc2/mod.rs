use std::{collections::HashSet, sync::LazyLock};

struct Codes {
    sorted: Vec<String>,
    set: HashSet<String>,
}

static PFC2_CODES: LazyLock<Codes> = LazyLock::new(|| {
    let mut sorted = normalize(&include_str!("codes.csv").lines().collect::<Vec<_>>());
    sorted.sort_unstable();
    let set = sorted.iter().cloned().collect();
    Codes { sorted, set }
});

pub fn codes() -> &'static [String] {
    &PFC2_CODES.sorted
}

pub fn valid(code: &str) -> bool {
    PFC2_CODES.set.contains(&normalize_code(code))
}

pub fn normalize(input: &[impl AsRef<str>]) -> Vec<String> {
    let mut seen = HashSet::with_capacity(input.len());
    input
        .iter()
        .map(|value| normalize_code(value.as_ref()))
        .filter(|value| !value.is_empty())
        .filter(|value| seen.insert(value.clone()))
        .collect()
}

fn normalize_code(code: &str) -> String {
    code.trim().to_ascii_uppercase()
}

#[cfg(test)]
mod tests {
    use super::{codes, normalize, valid};

    #[test]
    fn embeds_and_normalizes_pfc_codes() {
        assert!(!codes().is_empty());
        assert!(valid(" food_and_drink_groceries "));
        assert!(!valid("NOT_A_PFC2_CODE"));
    }

    #[test]
    fn normalizes_without_reordering_first_occurrences() {
        assert_eq!(
            normalize(&[
                " food_and_drink_groceries ",
                "",
                "FOOD_AND_DRINK_GROCERIES",
                "OTHER_OTHER"
            ]),
            ["FOOD_AND_DRINK_GROCERIES", "OTHER_OTHER"]
        );
    }
}
