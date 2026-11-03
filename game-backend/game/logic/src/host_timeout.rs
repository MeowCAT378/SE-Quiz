//! Server-owned host deadlines, independent of slide transitions.
use crate::time::{Duration, Timestamp};

/// Production policy; intentionally absent from all configuration surfaces.
pub const DEFAULT_GAME_TIMEOUT: Duration = Duration::from_mins(10);
/// Warn a connected host this long before expiration.
pub const DEFAULT_GAME_TIMEOUT_WARNING: Duration = Duration::from_mins(1);

// Isolated transport tests compile a separate debug artifact. Release builds
// reject this seam; no request, account, database or runtime setting selects it.
#[cfg(all(host_timeout_test, not(debug_assertions)))]
compile_error!("host_timeout_test is forbidden in release builds");

pub(crate) fn timeout_duration() -> Duration {
    #[cfg(host_timeout_test)]
    {
        Duration::from_secs(6)
    }
    #[cfg(not(host_timeout_test))]
    {
        DEFAULT_GAME_TIMEOUT
    }
}
pub(crate) fn warning_interval() -> Duration {
    #[cfg(host_timeout_test)]
    {
        Duration::from_secs(2)
    }
    #[cfg(not(host_timeout_test))]
    {
        DEFAULT_GAME_TIMEOUT_WARNING
    }
}

#[derive(Debug)]
#[cfg_attr(feature = "serializable", derive(serde::Serialize, serde::Deserialize))]
pub(crate) struct HostTimeout {
    pub last_activity: Timestamp,
    pub disconnected_at: Option<Timestamp>,
    pub generation: u64,
    pub warned: bool,
}

impl HostTimeout {
    pub fn new(now: Timestamp) -> Self {
        Self {
            last_activity: now,
            disconnected_at: Some(now),
            generation: 0,
            warned: false,
        }
    }
}

impl HostTimeout {
    pub fn reset(&mut self, now: Timestamp, connected: bool) {
        if connected {
            self.last_activity = now;
        }
        self.disconnected_at = (!connected).then_some(now);
        // Previously scheduled timeout callbacks must not expire a renewed host deadline.
        self.generation += 1;
        self.warned = false;
    }

    pub fn remaining(&self, now: Timestamp) -> Duration {
        timeout_duration().saturating_sub(now.duration_since(self.disconnected_at.unwrap_or(self.last_activity)))
    }

    pub fn next(&self, now: Timestamp) -> Duration {
        let remaining = self.remaining(now);
        if self.disconnected_at.is_none() && !self.warned {
            remaining.saturating_sub(warning_interval())
        } else {
            remaining
        }
    }
}
