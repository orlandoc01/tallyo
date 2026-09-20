use std::collections::HashMap;

use chrono::{DateTime, Utc};
use chrono_tz::Tz;

use crate::{
    ids::Date,
    money::Cents,
    schema::{AssetClassifier, LiabilityCategory},
};

use super::{
    ClassifierHistoryPoint, ClassifierSnapshotValue, LiabilityHistoryPoint, SnapshotValue,
    liabilities::{self, LIABILITY_SERIES_ORDER},
    series::{AccountSnapshotValue, account_snapshots_by_account, forward_filled_snapshot},
    timezone::local_date,
};

const CLASSIFIER_SERIES_ORDER: [AssetClassifier; 6] = [
    AssetClassifier::Cash,
    AssetClassifier::Public,
    AssetClassifier::CompanyEquity,
    AssetClassifier::Cryptocurrency,
    AssetClassifier::Stablecoin,
    AssetClassifier::RealEstate,
];

pub(super) fn classifier_history_series(
    values: Vec<ClassifierSnapshotValue>,
    dates: &[DateTime<Tz>],
    timezone: &str,
) -> Vec<ClassifierHistoryPoint> {
    let by_account = classifier_snapshots_by_account(values, timezone);
    history_values(dates, &by_account, classifier_values, CLASSIFIER_SERIES_ORDER)
        .into_iter()
        .flat_map(|(date, values)| {
            CLASSIFIER_SERIES_ORDER.into_iter().filter_map(move |classifier| {
                values.get(&classifier).map(|value| ClassifierHistoryPoint {
                    date: Date::new(date.clone()).expect("sample date is canonical"),
                    classifier,
                    label: classifier_history_label(classifier).to_owned(),
                    value_usd: *value,
                })
            })
        })
        .collect()
}

pub(super) fn liability_history_series(
    values: Vec<SnapshotValue>,
    dates: &[DateTime<Tz>],
    timezone: &str,
) -> Vec<LiabilityHistoryPoint> {
    let values: Vec<_> = values
        .into_iter()
        .filter(|value| liabilities::is_liability_type(value.account_type))
        .collect();
    let by_account = account_snapshots_by_account(&values, timezone);
    history_values(dates, &by_account, liability_values, LIABILITY_SERIES_ORDER)
        .into_iter()
        .flat_map(|(date, values)| {
            LIABILITY_SERIES_ORDER.into_iter().filter_map(move |category| {
                values.get(&category).map(|value| LiabilityHistoryPoint {
                    date: Date::new(date.clone()).expect("sample date is canonical"),
                    category,
                    label: liability_history_label(category).to_owned(),
                    value_usd: *value,
                })
            })
        })
        .collect()
}

#[derive(Clone)]
struct ClassifierSnapshot {
    local_date: String,
    synced_at: DateTime<Utc>,
    classifier: AssetClassifier,
    value: Cents,
    closed: bool,
}

fn classifier_snapshots_by_account(
    values: Vec<ClassifierSnapshotValue>,
    timezone: &str,
) -> HashMap<i64, Vec<ClassifierSnapshot>> {
    let mut grouped = values.into_iter().fold(HashMap::new(), |mut grouped, value| {
        grouped
            .entry(value.account_id)
            .or_insert_with(Vec::new)
            .push(ClassifierSnapshot {
                local_date: local_date(value.synced_at, timezone),
                synced_at: value.synced_at,
                classifier: value.classifier,
                value: value.value_usd,
                closed: value.account_closed,
            });
        grouped
    });
    grouped.values_mut().for_each(|snapshots| {
        snapshots.sort_by_key(|snapshot| {
            (
                snapshot.local_date.clone(),
                snapshot.synced_at,
                snapshot.classifier.to_string(),
            )
        });
    });
    grouped
}

fn classifier_values(snapshots: &[ClassifierSnapshot], date: &str) -> HashMap<AssetClassifier, Cents> {
    let index = snapshots.partition_point(|snapshot| snapshot.local_date.as_str() <= date);
    let Some(index) = index.checked_sub(1) else {
        return HashMap::new();
    };
    let Some(snapshot) = snapshots.get(index) else {
        return HashMap::new();
    };
    if snapshots.first().is_some_and(|first| first.closed) && date > snapshots.last().unwrap().local_date.as_str() {
        return HashMap::new();
    }
    let first = snapshots[..=index]
        .iter()
        .rposition(|candidate| candidate.local_date != snapshot.local_date || candidate.synced_at != snapshot.synced_at)
        .map_or(0, |previous| previous + 1);
    snapshots[first..=index]
        .iter()
        .fold(HashMap::new(), |mut values, snapshot| {
            *values.entry(snapshot.classifier).or_default() += snapshot.value;
            values
        })
}

fn liability_values(snapshots: &[AccountSnapshotValue], date: &str) -> HashMap<LiabilityCategory, Cents> {
    let Some(snapshot) = forward_filled_snapshot(snapshots, date) else {
        return HashMap::new();
    };
    let category = if snapshot.manual {
        LiabilityCategory::Other
    } else {
        liabilities::liability_category(snapshot.account_type, snapshot.account_subtype.as_deref())
    };
    HashMap::from([(category, -snapshot.value)])
}

fn history_values<K, S>(
    dates: &[DateTime<Tz>],
    by_account: &HashMap<i64, Vec<S>>,
    values: impl Fn(&[S], &str) -> HashMap<K, Cents>,
    order: impl IntoIterator<Item = K>,
) -> Vec<(String, HashMap<K, Cents>)>
where
    K: Copy + Eq + std::hash::Hash,
{
    let order: Vec<_> = order.into_iter().collect();
    let mut non_zero = HashMap::new();
    let values_by_date: Vec<_> = dates
        .iter()
        .map(|date| {
            let date = date.format("%F").to_string();
            let values = by_account.values().fold(HashMap::new(), |mut totals, snapshots| {
                values(snapshots, &date)
                    .into_iter()
                    .for_each(|(key, value)| *totals.entry(key).or_default() += value);
                totals
            });
            values
                .iter()
                .filter(|(_, value)| **value != Cents::default())
                .for_each(|(key, _)| {
                    non_zero.insert(*key, true);
                });
            (date, values)
        })
        .collect();
    values_by_date
        .into_iter()
        .map(|(date, values)| {
            let values = order
                .iter()
                .filter(|key| non_zero.contains_key(key))
                .map(|key| (*key, *values.get(key).unwrap_or(&Cents::default())))
                .collect();
            (date, values)
        })
        .collect()
}

fn classifier_history_label(classifier: AssetClassifier) -> &'static str {
    match classifier {
        AssetClassifier::Cash => "Cash & Equivalents",
        AssetClassifier::Public => "Public Assets",
        AssetClassifier::CompanyEquity => "Company Equity",
        AssetClassifier::Cryptocurrency => "Crypto",
        AssetClassifier::Stablecoin => "Stablecoin",
        AssetClassifier::RealEstate => "Real Estate",
    }
}

fn liability_history_label(category: LiabilityCategory) -> &'static str {
    match category {
        LiabilityCategory::Card => "Credit Card",
        LiabilityCategory::Mortgage => "Mortgage",
        LiabilityCategory::Loan => "Loan",
        LiabilityCategory::Other => "Other Liabilities",
    }
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;

    use super::*;

    #[test]
    fn classifier_history_keeps_zero_points_after_a_classifier_has_value() {
        let dates = [
            chrono_tz::UTC.with_ymd_and_hms(2026, 6, 1, 12, 0, 0).unwrap(),
            chrono_tz::UTC.with_ymd_and_hms(2026, 6, 2, 12, 0, 0).unwrap(),
        ];
        let points = classifier_history_series(
            vec![
                ClassifierSnapshotValue {
                    account_id: 1,
                    account_closed: false,
                    synced_at: "2026-06-01T12:00:00Z".parse().unwrap(),
                    classifier: AssetClassifier::Cash,
                    value_usd: Cents(100),
                },
                ClassifierSnapshotValue {
                    account_id: 1,
                    account_closed: false,
                    synced_at: "2026-06-02T12:00:00Z".parse().unwrap(),
                    classifier: AssetClassifier::Cash,
                    value_usd: Cents::default(),
                },
            ],
            &dates,
            "UTC",
        );

        assert_eq!(
            points.iter().map(|point| point.value_usd).collect::<Vec<_>>(),
            [Cents(100), Cents::default()]
        );
    }

    #[test]
    fn classifier_and_liability_history_group_current_snapshot_values() {
        let dates = [
            chrono_tz::UTC.with_ymd_and_hms(2026, 6, 1, 12, 0, 0).unwrap(),
            chrono_tz::UTC.with_ymd_and_hms(2026, 6, 2, 12, 0, 0).unwrap(),
        ];
        let classifiers = classifier_history_series(
            vec![
                ClassifierSnapshotValue {
                    account_id: 1,
                    account_closed: false,
                    synced_at: "2026-06-01T12:00:00Z".parse().unwrap(),
                    classifier: AssetClassifier::Cash,
                    value_usd: Cents(100),
                },
                ClassifierSnapshotValue {
                    account_id: 1,
                    account_closed: false,
                    synced_at: "2026-06-01T12:00:00Z".parse().unwrap(),
                    classifier: AssetClassifier::Public,
                    value_usd: Cents(200),
                },
                ClassifierSnapshotValue {
                    account_id: 1,
                    account_closed: false,
                    synced_at: "2026-06-02T12:00:00Z".parse().unwrap(),
                    classifier: AssetClassifier::Cash,
                    value_usd: Cents(50),
                },
            ],
            &dates,
            "UTC",
        );
        let liabilities = liability_history_series(
            vec![
                SnapshotValue {
                    account_id: 1,
                    account_type: crate::accounts::AccountType::Credit,
                    account_manual: false,
                    account_subtype: None,
                    account_closed: false,
                    synced_at: "2026-06-01T12:00:00Z".parse().unwrap(),
                    balance_usd: Cents(-300),
                },
                SnapshotValue {
                    account_id: 2,
                    account_type: crate::accounts::AccountType::Loan,
                    account_manual: true,
                    account_subtype: Some("mortgage".to_owned()),
                    account_closed: false,
                    synced_at: "2026-06-01T12:00:00Z".parse().unwrap(),
                    balance_usd: Cents(-400),
                },
            ],
            &dates,
            "UTC",
        );

        assert_eq!(
            classifiers.iter().map(|point| point.value_usd).collect::<Vec<_>>(),
            [Cents(100), Cents(200), Cents(50), Cents::default()]
        );
        assert_eq!(
            liabilities.iter().map(|point| point.value_usd).collect::<Vec<_>>(),
            [Cents(300), Cents(400), Cents(300), Cents(400)]
        );
        assert_eq!(classifier_history_label(AssetClassifier::Cryptocurrency), "Crypto");
        assert_eq!(liability_history_label(LiabilityCategory::Mortgage), "Mortgage");
    }

    #[test]
    fn labels_every_history_series_and_closes_classifier_history() {
        let dates = [
            chrono_tz::UTC.with_ymd_and_hms(2026, 6, 1, 12, 0, 0).unwrap(),
            chrono_tz::UTC.with_ymd_and_hms(2026, 6, 2, 12, 0, 0).unwrap(),
        ];
        let points = classifier_history_series(
            vec![ClassifierSnapshotValue {
                account_id: 1,
                account_closed: true,
                synced_at: "2026-06-01T12:00:00Z".parse().unwrap(),
                classifier: AssetClassifier::Cash,
                value_usd: Cents(100),
            }],
            &dates,
            "UTC",
        );

        assert_eq!(
            [
                AssetClassifier::Cash,
                AssetClassifier::Public,
                AssetClassifier::CompanyEquity,
                AssetClassifier::Cryptocurrency,
                AssetClassifier::Stablecoin,
                AssetClassifier::RealEstate,
            ]
            .map(classifier_history_label),
            [
                "Cash & Equivalents",
                "Public Assets",
                "Company Equity",
                "Crypto",
                "Stablecoin",
                "Real Estate",
            ]
        );
        assert_eq!(
            [
                LiabilityCategory::Card,
                LiabilityCategory::Mortgage,
                LiabilityCategory::Loan,
                LiabilityCategory::Other,
            ]
            .map(liability_history_label),
            ["Credit Card", "Mortgage", "Loan", "Other Liabilities"]
        );
        assert_eq!(
            points.iter().map(|point| point.value_usd).collect::<Vec<_>>(),
            [Cents(100), Cents::default()]
        );
    }
}
