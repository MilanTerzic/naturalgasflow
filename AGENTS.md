# Architecture rules

- Build nomination dates independently from balance rows and extend the shared read range through D+1, so day-ahead entry works even when the forecast range excludes tomorrow.