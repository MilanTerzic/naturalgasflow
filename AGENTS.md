# Architecture rules

- Build nomination dates independently from balance rows and extend the shared read range through D+1, so day-ahead entry works even when the forecast range excludes tomorrow.
- Route all ENTSOG HTTP reads through the shared server cache, keyed by endpoint, filters, entity and gas day; persist validated public observations insert-only and fetch gaps rather than cached ranges, so data survives deployments and partial outages without freezing unfinished physical-flow totals.
- Use the shared pageMetadata helper in leaf route heads for consistent page-specific title, description and social metadata without inherited preview images.