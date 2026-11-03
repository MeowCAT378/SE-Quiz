use std::{borrow::Borrow, fmt::Debug};

use dashmap::DashMap;

#[derive(Clone)]
#[derive_where::derive_where(Default)]
pub struct ClashMap<K: Eq + std::hash::Hash + Clone, V: Clone>(DashMap<K, V>);

impl<K, V> Debug for ClashMap<K, V>
where
    K: Eq + std::hash::Hash + Clone + Debug,
    V: Clone + Debug,
{
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(f)
    }
}

impl<K, V> ClashMap<K, V>
where
    K: Eq + std::hash::Hash + Clone,
    V: Clone,
{
    pub fn get<Q>(&self, key: &Q) -> Option<V>
    where
        K: Borrow<Q>,
        Q: std::hash::Hash + Eq + ?Sized,
    {
        self.0.get(key).map(|v| v.to_owned())
    }

    pub fn insert(&self, key: K, value: V) -> Option<V> {
        self.0.insert(key, value)
    }

    pub fn remove_if(&self, key: &K, predicate: impl FnOnce(&V) -> bool) -> Option<(K, V)> {
        self.0.remove_if(key, |_, value| predicate(value))
    }

    pub fn entries(&self) -> Vec<(K, V)> {
        self.0.iter().map(|e| (e.key().clone(), e.value().clone())).collect()
    }
}
