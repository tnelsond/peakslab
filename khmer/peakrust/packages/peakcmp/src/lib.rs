use std::cmp::Ordering;

// [dependencies]
// alphanumeric-sort = "1.5"

pub fn cmp(a: &str, b: &str) -> Ordering {
    alphanumeric_sort::compare_str(a.to_lowercase(), b.to_lowercase())
}
