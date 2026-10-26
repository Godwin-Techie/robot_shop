# Robot Shop API Availability SLO

## Objective

Maintain at least **99% request availability over a rolling 24-hour window**
for the Robot Shop `cart`, `catalogue`, and `payment` APIs.

This is a request-based SLO for the instrumented APIs, not a direct measurement
of browser-to-website availability. The `web` service currently exposes basic
NGINX exporter metrics but does not expose the HTTP status counter used by this
SLI.

## Service-level indicator

For each eligible request handled by cart, catalogue, or payment:

- A response with an HTTP status from 100 through 499 is considered good.
- A response with an HTTP status from 500 through 599 is considered bad.
- `/health` and `/metrics` requests are excluded by the application metrics.

This treats 4xx responses as available because the service successfully
responded; it measures availability, not whether the request produced the
expected business result.

The combined availability SLI is:

```text
good eligible requests / all eligible requests * 100
```

PromQL for the rolling 24-hour SLI:

```promql
100 *
(
  sum(increase(robotshop_http_requests_total{
    service=~"cart|payment",
    status_code=~"[1-4][0-9][0-9]"
  }[24h]))
  +
  sum(increase(robotshop_http_requests{
    service="catalogue",
    status_code=~"[1-4][0-9][0-9]"
  }[24h]))
)
/
(
  sum(increase(robotshop_http_requests_total{
    service=~"cart|payment"
  }[24h]))
  +
  sum(increase(robotshop_http_requests{
    service="catalogue"
  }[24h]))
)
```

The catalogue counter is exposed under `robotshop_http_requests`, while cart
and payment use `robotshop_http_requests_total`; the query includes both metric
names deliberately.

## Error budget

A 99% target permits **1% of eligible requests to fail** during each rolling
24-hour window:

```text
request error budget = eligible requests * 0.01
```

At a uniform request rate, 1% of a day is **14.4 minutes**. This time equivalent
is an intuition only: the actual SLO and budget are request-based, not measured
as wall-clock downtime.

## Interpretation and limitations

- The combined result is weighted by request volume. A busy service can mask a
  less busy service's degradation, so inspect each service separately when
  investigating an incident.
- Load-generator traffic is included. The SLI therefore describes the
  instrumented requests reaching these APIs, not independent real-user
  availability.
- Prometheus is configured for 24-hour retention with a 2 GB retention-size
  limit. If that size limit evicts samples sooner, the full 24-hour query may
  have incomplete data. Confirm the query has data before treating its value
  as a complete SLO measurement.
- At the time this objective was created, the counters had not yet accumulated
  a full 24-hour history. The current query result is not yet a complete
  24-hour compliance result.
